;(function() {
    //Pattern for determing the protocol of a url
    var PROTOCOL_PATTERN = /^(http|ws|wss|https):\/\//;
    
    //Don't add the method to the function prototype if a native implementation
    //already exists. Based on the prototype.js implementation.
    if (!Function.prototype.bind) {
        //Exposes a mechanism for binding a function's scope to a specified
        //object
        Function.prototype.bind = function() {
            var fn = this;
            var args = Array.prototype.slice.call(arguments);
            var object = args.shift();
            
            return function() {
                return fn.apply(object, args.concat(Array.prototype.slice.call(arguments))); 
            }; 
        };
    }
    
    //Try to parse the JSON and throw an error if it fails
    var parseJSON = function(data) {
        try {
            return JSON.parse(data);
        } catch(e) {
            if(this.onerror) {
                this.onerror('receiveJunk', 'Received non-JSON message from the server');
            }
        }
    }
    
    //Comet implementation that uses websockets
    function WebSocketClient(url) {
        //Change the URL from http://... to ws://... if necessary
        var protocolMatch = PROTOCOL_PATTERN.exec(url)[1];
        
        if(protocolMatch === "https") {
            this.url = url.replace(PROTOCOL_PATTERN, "wss://");
        } else if(protocolMatch === "http") {
            this.url = url.replace(PROTOCOL_PATTERN, "ws://");
        } else {
            this.url = url;
        }
        
        this._init();
    }
    
    WebSocketClient.prototype = {
        type: 'websocket',
        onmessage: null,
        onerror: null,
        errors: 0,
        url: null,
        queue: [],
        
        //Creates a new websocket and adds event listeners
        _init: function() {
            this._socket = new WebSocket(this.url);
            this._socket.onmessage = this._handleMessage.bind(this);
            this._socket.onerror = this._handleError.bind(this);
        },
        
        //Called when a message is received from the websocket
        _handleMessage: function(message) {
            var json = parseJSON.bind(this)(message.data);
            if(!json) return false;
            
            if(json.type && json.payload) {
                if(json.type == 'message') {
                    //Call the message event listener if it's a message
                    if(this.onmessage) {
                        this.onmessage(json.payload);
                    }
                    
                    return true;
                } else if(json.type == 'error') {
                    //Call the error event listener if it's an error
                    var errorName = json.payload.errorName;
                    var errorMessage = json.payload.message;
                    
                    if(errorName && errorMessage) {
                        if(this.onerror) {
                            this.onerror(json.payload.errorName, json.payload.message);
                        }
                        
                        return false;
                    }
                }
            }
            
            //The server-sent JSON does not follow expected standards
            this.onerror('receiveBadServerJSON', 'Received bad JSON message from the server');
            return false;
        },
        
        //Call the error listener, then try to reconnect
        _handleError: function(error) {
            if(this.onerror) {
                this.onerror('connect', 'Could not connect');
            }
            
            this.errors++;
            setTimeout(this._init, 1000 * this.errors * this.errors);
        },
        
        //Sends a message to the server
        send: function(json) {
            var data = JSON.stringify(json);
            var self = this;
            
            //Keep trying to send the message until we're connected to the
            //server
            var lazySend = function() {
                if(self._socket.readyState != self._socket.OPEN) {
                    setTimeout(lazySend, 1);
                } else {
                    self._socket.send(data);
                }
            };
            
            lazySend();
        },
        
        //Closes the connection
        close: function() {
            this._socket.close();
        }
    };
    
    //Comet implementation that uses long polling
    function LongPollingClient(url) {
        //If the user accidently sent a websocket url, change it back to http
        var protocolMatch = PROTOCOL_PATTERN.exec(url)[1];
        
        if(protocolMatch === "wss") {
            this.url = url.replace(PROTOCOL_PATTERN, "https://");
        } else if(protocolMatch === "ws") {
            this.url = url.replace(PROTOCOL_PATTERN, "http://");
        } else {
            this.url = url;
        }
        
        this._init();
    }
    
    LongPollingClient.prototype = {
        type: 'longpolling',
        clientId: null,
        errors: 0,
        
        //Sets up the long-polling mechanisms
        _init: function() {
            var self = this;
            
            //Connects to the server using xhr
            var connect = function() {
                var socket = self._createXHR();
                self._socket = socket;
                
                //Handles a response from the xhr object
                socket.onreadystatechange = function() {
                    if(socket.readyState == 4) {
                        if(socket.status >= 200 && socket.status <= 299) {
                            self._handleMessage(socket.responseText);
                            
                            //Reopen the connection immediately.
                            connect();
                        } else {
                            //Handle the error, then try to reconnect.
                            if(self.onerror) self.onerror(socket);
                            self.errors++;
                            setTimeout(connect, 1000 * self.errors * self.errors);
                        }
                    }
                };
            
                // use the date/time suffix for anti-caching and use the
                // clientId to 'catch up' with events we missed.
                var time = (new Date()).getTime();
                
                if(self.clientId != null) {
                    var queryString = "?clientId=" + self.clientId + "&" + time;
                } else {
                    var queryString = "?" + time;
                }
                
                // start the connection.
                socket.open("GET", self.url + queryString, true);
                socket.send();
            };
            
            connect();
        },
        
        _handleMessage: function(data) {
            //Parse the response
            var json = parseJSON.bind(this)(data);
            if(!json) return false;
            
            this.clientId = json.clientId;
            var payload = json.payload;
            
            if(clientId && payload && payload instanceof Array) {
                var messageHandler = this.onmessage;
                
                if(this.onmessage) {
                    for(var i=0, len=payload.length; i<len; i++) {
                        messageHandler(payload[i]);
                    }
                }
            }
            
            //The server-sent JSON does not follow expected standards
            this.onerror('receiveBadServerJSON', 'Received bad JSON message from the server');
            return false;
        },
        
        //Sends a message to the server
        send: function(data) {
            var xhr = this._createXHR();
            
            //Handles a response from the xhr object
            xhr.onReadyStateChange = function() {
                if(xhr.readyState == 4 && (xhr.status < 200 || xhr.status > 299)) {
                    if(this.onerror) this.onerror(xhr);
                }
            }
            
            //Send the message
            xhr.open("POST", this.url, true);
            xhr.setRequestHeader("Content-type","application/json");
            xhr.send(JSON.stringify(data));
        },
        
        //Close the socket
        close: function() {
            if(this._socket && this._socket.readyState != 4) {
                this._socket.abort();
            }
        },
        
        //Creates an XHR object for AJAX
        _createXHR: function() {
            if(window.XMLHttpRequest) {
                return new XMLHttpRequest();
            } else {
                try {
                    return new ActiveXObject("Msxml2.XMLHTTP");
                } catch(e) {
                    return new ActiveXObject("Microsoft.XMLHTTP");
                }
            }
        }
    };
    
    //Creates a comet connection based on the capabilities of the client
    function comet(url) {
        var cls = window.WebSocket ? WebSocketClient : LongPollingClient;
        return new cls(url);
    }
    
    this.comet = comet;
})(window);