;(function() {
    var PROTOCOL_PATTERN = /^(http|ws|wss|https):\/\//;
    
    function WebSocketClient(url) {
        this.onMessage = null;
        this.onError = null;
        this.errors = 0;
        
        var protocolMatch = PROTOCOL_PATTERN.exec(url)[1];
        
        if(protocolMatch === "https") {
            this.url = url.replace(PROTOCOL_PATTERN, "wss://");
        } else if(protocolMatch === "http") {
            this.url = url.replace(PROTOCOL_PATTERN, "ws://");
        } else {
            this.url = url;
        }
        
        this.init();
    }
    
    WebSocketClient.prototype = {
        onMessage: null,
        onError: null,
        errors: 0,
        url: null,
        queue: [],
        
        init: function() {
            this._socket = new WebSocket(this.url);
            var self = this;
            
            this._socket.onmessage = function(message) {
                if(self.onmessage) self.onmessage(JSON.parse(message.data));
            };
            
            this._socket.onerror = function(error) {
                // handle the error, then try to reconnect.
                if(self.onerror) self.onerror(error);
                self.errors++;
                setTimeout(self.init, 1000 * self.errors * self.errors);
            };
        },
        
        send: function(json) {
            var data = JSON.stringify(json);
            var self = this;
            
            var lazySend = function() {
                if(self._socket.readyState != self._socket.OPEN) {
                    setTimeout(lazySend, 1);
                } else {
                    self._socket.send(data);
                }
            };
            
            lazySend();
        },
        
        close: function() {
            this._socket.close();
        }
    };
    
    function LongPollingClient(url) {
        var protocolMatch = PROTOCOL_PATTERN.exec(url)[1];
        
        if(protocolMatch === "wss") {
            this.url = url.replace(PROTOCOL_PATTERN, "https://");
        } else if(protocolMatch === "ws") {
            this.url = url.replace(PROTOCOL_PATTERN, "http://");
        } else {
            this.url = url;
        }
        
        this.init();
    }
    
    LongPollingClient.prototype = {
        clientId: null,
        errors: 0,
        
        init: function() {
            // set up the long-polling mechanisms.
            var self = this;
            
            var connect = function() {
                var socket = self._createXHR();
                self._socket = socket;
                
                socket.onreadystatechange = function() {
                    // summary:
                    //          Handles the response for the long-polling 
                    //          request.
                    
                    if(socket.readyState == 4) {
                        if(socket.status >= 200 && socket.status <= 299) {
                            // Unlike for websockets, the longpolling responses
                            // come back as an array. Parse it here.
                            var json = JSON.parse(socket.responseText);
                            var payload = json.payload;
                            
                            // Iterate through the events and fire them all out.
                            if(self.onmessage) {
                                for(var i=0, len=payload.length; i<len; i++) {
                                    self.onmessage(payload[i]);
                                }
                            }
                            
                            // Grab the lastEventId.
                            self.clientId = json.clientId;
                            
                            // Reopen the connection immediately.
                            connect();
                        } else {
                            // handle the error, then try to reconnect.
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
        
        send: function(data) {
            var xhr = this._createXHR();
            var self = this;
            
            xhr.onReadyStateChange = function() {
                if(xhr.readyState == 4 && (xhr.status < 200 || xhr.status > 299)) {
                    if(this.onerror) this.onerror(xhr);
                }
            }
            
            xhr.open("POST", this.url, true);
            xhr.setRequestHeader("Content-type","application/json");
            xhr.send(JSON.stringify(data));
        },
        
        close: function() {
            if(this._socket && this._socket.readyState != 4) {
                this._socket.abort();
            }
        },
        
        _createXHR: function() {
            // summary:
            //          creates an XHR object for AJAX...
            // return:
            //          In all normal browsers: XMLHttpRequest, 
            //          IE6: ActiveXObject.
            
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
    
    function comet(url) {
        var cls = window.WebSocket ? WebSocketClient : LongPollingClient;
        return new cls(url);
    }
    
    this.comet = comet;
})(window);