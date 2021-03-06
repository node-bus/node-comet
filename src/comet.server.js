var events = require("events"),
    sys = require('sys'),
    URL = require('url'),
    QueryString = require('querystring');
    
//The ID of the last client that connected (used as a counter)
var lastClientId = 0;

//A mapping oc client IDs to the implementing endpoints
var clientEndpoints = {};

//Maximum time in-between connections for long polling before the client is
//considered disconnected
var MESSAGE_TIMEOUT = 10 * 1000;

//Message sent to the client when it sends bad JSON data
var BAD_CLIENT_MESSAGE = {
    type: 'error',
    payload: {
        errorName: 'badClientJSON',
        message: 'Received bad json from the client'
    }
};

//Message sent to the client when it gives an unregistered clientId
var BAD_CLIENT_ID_MESSAGE = {
    type: 'error',
    payload: {
        errorName: 'badClientId',
        message: 'That client ID is not registered with the server'
    }
};

//Message sent to the client when they use an HTTP method not allowed at the
//time
var METHOD_NOT_ALLOWED_MESSAGE = {
    type: 'error',
    payload: {
        errorName: 'methodNotAllowed',
        message: 'You cannot use that HTTP method at this time'
    }
};

//Abstract class for representing comet endpoints. All subclasses must
//implement send() and close(). Server is the HTTP server instance that the
//comet endpoint should hook on to. pattern is the URL regex pattern to listen
//to for requests.
function CometEndpoint(server, pattern) {
    events.EventEmitter.call(this);
    this.clients = {};
    
    //Sends json to the specified client
    this.send = function(clientId, json) {
        throw new Error("CometEndpoint.send() not implemented.");
    };
    
    //Closes all client connections
    this.close = function() {
        throw new Error("CometEndpoint.close() not implemented.");
    };
    
    //Adds a client to the endpoint
    this.addClient = function(session) {
        var id = lastClientId++;
        this.clients[id] = session;
        clientEndpoints[id] = this;
        
        this.emit('connect', id);
        
        return id;
    };
    
    //Removes a client from the endpoint
    this.removeClient = function(id) {
        this.emit('close', id);
        delete this.clients[id];
        delete clientEndpoints[id];
    };
    
    //Try to parse incoming JSON data and send out the appropriate event.
    //Returns whether the incoming JSON data was valid.
    this._publishReceive = function(clientId, content) {
        try {
            var json = JSON.parse(content);
        } catch(e) {
            //If we could not parse the json, throw a junk event
            this.emit('receiveJunk', clientId, content);
            return false;
        }
        
        //Throw out an event with the json if it was parsed
        this.emit('receive', clientId, json);
        return true;
    };
}

sys.inherits(CometEndpoint, events.EventEmitter);

//Implementation for WebSocket-based communication
function WebSocketEndpoint(server, pattern) {
    CometEndpoint.call(this);
    var self = this;
    
    // listen for 'upgrade' events, so we can handle websockets.
    server.addListener('upgrade', function(request, socket, head) {
        if(request.headers['upgrade'] === "WebSocket" && request.url.match(pattern)) {
            self._handleRequest(request, socket);
        }
    });
    
    this._handleRequest = function(request, socket) {
        // Attempt to make the socket unable to time out.
        socket.setTimeout(0);
        socket.setKeepAlive(true);
        
        // We're going to be transmiting utf-8 strings.
        socket.setEncoding('utf8');
        
        // Immediately flush data when socket.write is called.
        socket.setNoDelay(true);
        
        // Set up the handshake.
        socket.write([
            'HTTP/1.1 101 Web Socket Protocol Handshake', 
            'Upgrade: WebSocket', 
            'Connection: Upgrade',
            'WebSocket-Origin: ' + request.headers.origin,
            'WebSocket-Location: ws://' + request.headers.host + request.url,
            '', ''
        ].join('\r\n'));
        
        //send out a connect event
        var clientId = self.addClient(socket);
        
        // listen for socket events.
        socket.addListener("data", self._handleData(clientId, socket));
        socket.addListener("end", self._handleDisconnect(clientId, socket));
        socket.addListener("timeout", self._handleDisconnect(clientId, socket));
        socket.addListener("error", self._handleDisconnect(clientId, socket));
    };
    
    //The private send method. Sends raw json content.
    this._send = function(clientId, json) {
        // If we're connected, write out the data (in the format specified by 
        // WebSocket Protocol spec.
        var socket = self.clients[clientId];
        
        if(socket) {
            socket.write('\u0000', 'binary');
            socket.write(JSON.stringify(json), 'utf8');
            socket.write('\uffff', 'binary');
        }
    };
    
    this.send = function(clientId, json) {
        self._send(clientId, {
            type: 'message',
            payload: json
        });
    };
        
    this.close = function() {
        var clients = self.clients;
        
        for(var clientId in clients) {
            clients[clientId].end();
            self.removeClient(clientId);
        }
    };
    
    //Returns a new function that can act as a callback for data events from
    //sockets.
    this._handleData = function(clientId, socket) {
        //Handles data coming from the client, and publishes the appropriate
        //event
        return function(data) {
            var chunks = data.split('\ufffd');
            
            // initialze variables used by the array.
            var chunk = null;
            var chunkCount = chunks.length - 1;
            
            // iterate through the chunks
            for (var i = 0; i < chunkCount; i++) {
                chunk = chunks[i];
                
                //if it doesnt start with the start character, then throw an
                //error.
                if (chunk[0] != '\u0000') {
                    continue;
                }
                
                // remove the start character
                chunk = chunk.substr(1);
                
                // publish
                if(!self._publishReceive(clientId, chunk)) {
                    self._send(clientId, BAD_CLIENT_MESSAGE);
                }
            }
        };
    };
    
    //Returns a new function that can act as a callback for events that
    //should disconnect the user
    this._handleDisconnect = function(clientId, socket) {
        return function() {
            // close out the socket
            socket.end();
            self.removeClient(clientId);
        };
    };
}

sys.inherits(WebSocketEndpoint, CometEndpoint);

//A long-polling implementation of a comet endpoint. The important thing to
//note with this is that clients could miss events that are published while
//they are re-establishing their HTTP long-poll request. What we'll do to
//mitigate this is maintain a queue of events that occurred between requests
//in the client's session.
function LongPollingEndpoint(server, pattern) {
    CometEndpoint.call(this);
    var self = this;
    
    //Listens for request events for the http server
    server.addListener('request', function(request, response) {
        //Only do anything if the url pattern matches
        if(request.url.match(pattern)) {
            self._handleRequest(request, response);
        }
    });
    
    this._handleRequest = function(request, response) {
        var parsedRequestUrl = URL.parse(request.url);
        var query = QueryString.parse(parsedRequestUrl.query);
        var clientId = null;
        
        //Try to pull up the client's session if it exists
        try {
            clientId = parseInt(query['clientId']);
            if(isNaN(clientId)) clientId = null;
        } catch(e) {}
        
        if(!clientId && clientId != 0) {
            //Create a new client session if there isn't one yet
            clientId = self.addClient({
                queue: [],
                socket: response
            });
            
            if(request.method == 'GET') {
                //Send a stub message with just the client id if it's a new
                //connection
                self._sendThruSession(clientId, 200, {
                    clientId: clientId
                });
            } else {
                //Only GETs are allowed without a client id
                self._sendThruSession(clientId, 400, BAD_CLIENT_ID_MESSAGE);
            }
        }
        
        if(request.method == 'GET') {
            self._handleGet(clientId, request, response);
        } else if(request.method == 'POST') {
            self._handlePost(clientId, request, response);
        } else {
            self._sendThruSession(clientId, 400, METHOD_NOT_ALLOWED_MESSAGE);
        }
    };
    
    this._handleGet = function(clientId, request, response) {
        var session = self.clients[clientId];
        if(!session) return;
        
        //Clear the disconnect timeout if there is a session since the
        //client is reconnecting
        clearTimeout(session.timeoutId);
        session.socket = response;
        
        //Flush the queue if anything is in it
        if(session.queue && session.queue.length > 0) {
            self._sendThruSession(clientId, 200, {
                payload: session.queue
            });
            
            session.queue = [];
        }
    };
    
    this._handlePost = function(clientId, request, response) {
        //Endpoint for publishing events
        var data = [];
        
        // listen for data events so we can collect the data.
        request.addListener('data', function(chunk) {
            data.push(chunk);
        });
        
        //Done receiving the event content - handle it
        request.addListener('end', function(chunk) {
            if(self._publishReceive(clientId, data.join(''))) {
                //Event is legit - return HTTP/200
                self._send(response, 200, {});
                
            } else {
                //Event is not legit - return HTTP/400
                self._send(response, 400, BAD_CLIENT_MESSAGE);
            }
            
            response.end();
        });
    };
    
    //Private implementation of send. Sends raw json content.
    this._send = function(socket, httpCode, json) {
        var data = JSON.stringify(json);
        
        // set the response headers correctly
        socket.writeHead(httpCode, {
            'Content-Length': data.length,
            'Content-Type': 'application/json'
        });
        
        // write it out
        socket.write(data);
        socket.end();
    };
    
    this._sendThruSession = function(clientId, httpCode, json) {
        var session = self.clients[clientId];
        var socket = session.socket;
        
        self._send(socket, httpCode, json);
        session.socket = null;
        
        //Create a timeout timer. If the timer hits, the user is disconnected.
        session.timeoutId = setTimeout(function() {
            self.removeClient(clientId);
        }, MESSAGE_TIMEOUT);
    };
    
    this.send = function(clientId, data) {
        var session = self.clients[clientId];
        if(!session) return;
        
        if(session.socket) {
            //Send out the event if the client is currently connected
            self._sendThruSession(clientId, 200, {
                payload: [data]
            });
        } else {
            //Enqueue the event otherwise
            session.queue.push(data);
        }
    };
    
    this.close = function() {
        var clients = self.clients;
        
        for(var clientId in clients) {
            var session = clients[clientId]
            if(session.socket) session.socket.end();
            self.removeClient(clientId);
        }
    };
}

sys.inherits(LongPollingEndpoint, CometEndpoint);

ENDPOINT_TYPES = {
    ws: WebSocketEndpoint,
    polling: LongPollingEndpoint
}

//Initializes the comet server. Creates an endpoint for each comet
//implementation. Server is the HTTP server to listen on. Pattern is a URL
//regex pattern to filter requests.
function CometServer(server, pattern) {
    for(var implName in ENDPOINT_TYPES) {
        var cls = ENDPOINT_TYPES[implName];
        var endpoint = new cls(server, pattern);
        var self = this;
        
        //Proxy all of the implementation events and add the comet
        //implementation to the arguments
        
        endpoint.addListener('connect', function(clientId) {
            self.emit('connect', clientEndpoints[clientId], clientId);
        });
        
        endpoint.addListener('close', function(clientId) {
            self.emit('close', clientEndpoints[clientId], clientId);
        });
        
        endpoint.addListener('receive', function(clientId, json) {
            self.emit('receive', clientEndpoints[clientId], clientId, json);
        });
        
        endpoint.addListener('receiveJunk', function(clientId, json) {
            self.emit('receiveJunk', clientEndpoints[clientId], clientId, json);
        });
    }
    
    //Sends a message to a specified client ID
    this.send = function(clientId, json) {
        //TODO: throw an error when the client doesn't exist
        clientEndpoints[clientId].send(clientId, json);
    };
}

sys.inherits(CometServer, events.EventEmitter);
exports.CometServer = CometServer;