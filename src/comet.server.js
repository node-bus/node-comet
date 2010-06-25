var events = require("events"),
    sys = require('sys'),
    URL = require('url'),
    QueryString = require('querystring');
    
var lastClientId = 0;
var clientEndpoints = {};
var MESSAGE_TIMEOUT = 10 * 1000;

function CometEndpoint(server, pattern) {
    events.EventEmitter.call(this);
    
    this.clients = {};
    
    this.send = function(clientId, data) {
        throw new Error("CometEndpoint.send() not implemented.");
    };
    
    this.close = function() {
        throw new Error("CometEndpoint.close() not implemented.");
    };
    
    this.addClient = function(session) {
        var id = lastClientId++;
        this.clients[id] = session;
        clientEndpoints[id] = this;
        
        return id;
    };
    
    this.removeClient = function(id) {
        delete this.clients[id];
        delete clientEndpoints[id];
    };
    
    this._publishReceive = function(clientId, content) {
        // parse the json and publish the event.
        try {
            var json = JSON.parse(content);
        } catch(e) {
            this.emit('receiveJunk', clientId, content);
            this._sendJunkErrorMessage(clientId);
        }
        
        if(json) this.emit('receive', clientId, json);
    };
}

sys.inherits(CometEndpoint, events.EventEmitter);

function WebSocketEndpoint(server, pattern) {
    CometEndpoint.call(this);
    var self = this;
    
    // listen for 'upgrade' events, so we can handle websockets.
    server.addListener('upgrade', function(request, socket, head) {
        if(request.headers['upgrade'] === "WebSocket" && request.url.match(pattern)) {
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
            
            var clientId = self.addClient(socket);
            self.emit('connect', clientId);
            
            // listen for socket events.
            socket.addListener("data", self._handleData(clientId, socket));
            socket.addListener("end", self._handleDisconnect(clientId, socket));
            socket.addListener("timeout", self._handleDisconnect(clientId, socket));
            socket.addListener("error", self._handleDisconnect(clientId, socket));
        }
    });
    
    this._send = function(clientId, json) {
        // If we're connected, write out the data (in the format specified by 
        // WebSocket Protocol spec.
        var socket = this.clients[clientId];
        
        if(socket) {
            socket.write('\u0000', 'binary');
            socket.write(JSON.stringify(json), 'utf8');
            socket.write('\uffff', 'binary');
        }
    };
    
    this._sendJunkErrorMessage = function(clientId) {
        self._send(clientId, {
            type: 'error',
            payload: {
                errorName: 'receiveBadClientJSON',
                message: 'Received bad json'
            }
        });
    };
    
    this.send = function(clientId, json) {
        this._send(clientId, {
            type: 'message',
            payload: json
        });
    };
        
    this.close = function() {
        var clients = this.clients;
        
        for(var clientId in clients) {
            clients[clientId].end();
            this.removeClient(clientId);
        }
    };
    
    this._handleData = function(clientId, socket) {
        // summary:
        //          Callback for the 'data' event of the socket.
        // description:
        //          Handles the data coming from the client, and publishes an 
        //          event to the ClientList.
        // data: String
        //          Data from the client.
        // throws:
        //          Error if data string isn't a valid JSON string.
        
        // split the data by the separator character.
        var self = this;
        
        return function(data) {
            var chunks = data.split('\ufffd');
            
            // initialze variables used by the array.
            var chunk = null;
            var chunkCount = chunks.length - 1;
            
            // iterate through the chunks
            for (var i = 0; i < chunkCount; i++) {
                chunk = chunks[i];
                
                // if it doesnt start with the start character, then throw an error.
                if (chunk[0] != '\u0000') {
                    continue;
                }
                
                // remove the start character
                chunk = chunk.substr(1);
                
                // publish
                self._publishReceive(clientId, chunk);
            }
        };
    };
    
    this._handleDisconnect = function(clientId, socket) {
        // summary: 
        //          Callback for the 'end' event of the socket.
        // description:
        //          Flags the client as disconnected, and calls close()
        var self = this;
        
        return function() {
            // close out the socket
            socket.end();
            self.removeClient(clientId);
        };
    };
}

sys.inherits(WebSocketEndpoint, CometEndpoint);

function LongPollingEndpoint(server, pattern) {
    // summary:
    //          Creates a client for node-bus where the client is 'connected' 
    //          via a long-polling Ajax mechanism.
    // description:
    //          LongPollingClient client objects do not directly represent a 
    //          Client as the WebSocketClient class tends to. Instead, it 
    //          represents an individual, long-polling, request from a client.  
    //          The important thing to note with this is that clients could miss 
    //          events that are published while they are re-establishing their 
    //          HTTP long-poll request.  What we'll do to mitigate this is allow 
    //          clients to specify a parameter in the query string for the 
    //          request called 'lastEventId' which they'll set equal to the 'id' 
    //          attribute of the latest event they've received.  This way, when 
    //          the next event is published we can look up and send all the 
    //          previous events between the 'lastEventId' and the newest event - 
    //          to catch the client up.
    
    CometEndpoint.call(this);
    var self = this;
    
    server.addListener('request', function(request, response) {
        if(request.url.match(pattern)) {
            var parsedRequestUrl = URL.parse(request.url);
            var query = QueryString.parse(parsedRequestUrl.query);
            var clientId = query['clientId'];
            
            if(clientId == undefined) {
                clientId = self.addClient({
                    socket: response,
                    queue: []
                });
                
                self.emit('connect', clientId);
            } else {
                clientId = parseInt(clientId);
                clearTimeout(self.clients[clientId]);
            }
            
            if(request.method == 'GET') {
                var session = self.clients[clientId];
                session.socket = response;
                
                if(session.queue && session.queue.length > 0) {
                    self._send(clientId, {
                        clientId: clientId,
                        payload: session.queue
                    });
                    
                    session.queue = [];
                }
            } else if(request.method == 'POST') {
                var data = [];
                
                // listen for data events so we can collect the data.
                request.addListener('data', function(chunk) {
                    data.push(chunk);
                });
                
                request.addListener('end', function(chunk) {
                    // publish
                    self._publishReceive(clientId, data.join(''));
                });
                
                response.writeHead(200);
                response.end();
            }
        }
    });
    
    this._send = function(clientId, json) {
        // summary:
        //          Sends an event, and the historical events, to the client by 
        //          writing to the response stream.
        // data: Object
        //          Event object to write to the client's response stream.
        
        var data = JSON.stringify(json);
        var session = this.clients[clientId];
        var socket = session.socket;
        
        // set the response headers correctly
        socket.writeHead(200, {
            'Content-Length': data.length,
            'Content-Type': 'application/json'
        });
        
        // write it out
        socket.write(data);
        socket.end();
        
        session.socket = null;
        session.timeoutId = setTimeout(function() {
            delete this.clients[clientId];
        }, MESSAGE_TIMEOUT);
    },
    
    this.send = function(clientId, data) {
        var session = this.clients[clientId];
        if(!session) return;
        
        sys.puts(JSON.stringify(session));
        
        if(session.socket) {
            this._send(clientId, {
                clientId: clientId,
                payload: [data]
            });
        } else {
            session.queue.push(data);
        }
    },
    
    this.close = function() {
        // summary:
        //          Prepares the LongPollingClient to be ready for the Garbage 
        //          collector.
        var clients = this.clients;
        for(var clientId in clients) {
            clients[clientId].end();
            this.removeClient(clientId);
        }
    };
}

sys.inherits(LongPollingEndpoint, CometEndpoint);

ENDPOINT_TYPES = {
    ws: WebSocketEndpoint,
    polling: LongPollingEndpoint
}

function CometServer(server, pattern) {
    // summary:
    //          Initialize the comet server.
    // description:
    //          Sets up listeners for 'request' and 'upgrade' events on the 
    //          server object when they match the given pattern.  Will handle 
    //          WebSocket requests and longpolling requests.
    // server: http.Server
    //          Http Server object.
    // pattern: RegExp
    //          URL pattern to match.
    // returns: 
    //          Nothing.
    
    for(var implName in ENDPOINT_TYPES) {
        var cls = ENDPOINT_TYPES[implName];
        var endpoint = new cls(server, pattern);
        var self = this;
        
        endpoint.addListener('connect', function(clientId) {
            self.emit('connect', clientEndpoints[clientId], clientId);
        });
        
        endpoint.addListener('receive', function(clientId, json) {
            self.emit('receive', clientEndpoints[clientId], clientId, json);
        });
        
        endpoint.addListener('receiveJunk', function(clientId, json) {
            self.emit('receiveJunk', clientEndpoints[clientId], clientId, json);
        });
    }
    
    this.send = function(clientId, data) {
        clientEndpoints[clientId].send(clientId, data);
    };
}

sys.inherits(CometServer, events.EventEmitter);
exports.CometServer = CometServer;