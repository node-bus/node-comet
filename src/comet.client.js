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
    
    /* json2.js from http://json.org/json2.js */
    if(!this.JSON){this.JSON={};}
    (function(){function f(n){return n<10?'0'+n:n;}
    if(typeof Date.prototype.toJSON!=='function'){Date.prototype.toJSON=function(key){return isFinite(this.valueOf())?this.getUTCFullYear()+'-'+
    f(this.getUTCMonth()+1)+'-'+
    f(this.getUTCDate())+'T'+
    f(this.getUTCHours())+':'+
    f(this.getUTCMinutes())+':'+
    f(this.getUTCSeconds())+'Z':null;};String.prototype.toJSON=Number.prototype.toJSON=Boolean.prototype.toJSON=function(key){return this.valueOf();};}
    var cx=/[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,escapable=/[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g,gap,indent,meta={'\b':'\\b','\t':'\\t','\n':'\\n','\f':'\\f','\r':'\\r','"':'\\"','\\':'\\\\'},rep;function quote(string){escapable.lastIndex=0;return escapable.test(string)?'"'+string.replace(escapable,function(a){var c=meta[a];return typeof c==='string'?c:'\\u'+('0000'+a.charCodeAt(0).toString(16)).slice(-4);})+'"':'"'+string+'"';}
    function str(key,holder){var i,k,v,length,mind=gap,partial,value=holder[key];if(value&&typeof value==='object'&&typeof value.toJSON==='function'){value=value.toJSON(key);}
    if(typeof rep==='function'){value=rep.call(holder,key,value);}
    switch(typeof value){case'string':return quote(value);case'number':return isFinite(value)?String(value):'null';case'boolean':case'null':return String(value);case'object':if(!value){return'null';}
    gap+=indent;partial=[];if(Object.prototype.toString.apply(value)==='[object Array]'){length=value.length;for(i=0;i<length;i+=1){partial[i]=str(i,value)||'null';}
    v=partial.length===0?'[]':gap?'[\n'+gap+
    partial.join(',\n'+gap)+'\n'+
    mind+']':'['+partial.join(',')+']';gap=mind;return v;}
    if(rep&&typeof rep==='object'){length=rep.length;for(i=0;i<length;i+=1){k=rep[i];if(typeof k==='string'){v=str(k,value);if(v){partial.push(quote(k)+(gap?': ':':')+v);}}}}else{for(k in value){if(Object.hasOwnProperty.call(value,k)){v=str(k,value);if(v){partial.push(quote(k)+(gap?': ':':')+v);}}}}
    v=partial.length===0?'{}':gap?'{\n'+gap+partial.join(',\n'+gap)+'\n'+
    mind+'}':'{'+partial.join(',')+'}';gap=mind;return v;}}
    if(typeof JSON.stringify!=='function'){JSON.stringify=function(value,replacer,space){var i;gap='';indent='';if(typeof space==='number'){for(i=0;i<space;i+=1){indent+=' ';}}else if(typeof space==='string'){indent=space;}
    rep=replacer;if(replacer&&typeof replacer!=='function'&&(typeof replacer!=='object'||typeof replacer.length!=='number')){throw new Error('JSON.stringify');}
    return str('',{'':value});};}
    if(typeof JSON.parse!=='function'){JSON.parse=function(text,reviver){var j;function walk(holder,key){var k,v,value=holder[key];if(value&&typeof value==='object'){for(k in value){if(Object.hasOwnProperty.call(value,k)){v=walk(value,k);if(v!==undefined){value[k]=v;}else{delete value[k];}}}}
    return reviver.call(holder,key,value);}
    text=String(text);cx.lastIndex=0;if(cx.test(text)){text=text.replace(cx,function(a){return'\\u'+
    ('0000'+a.charCodeAt(0).toString(16)).slice(-4);});}
    if(/^[\],:{}\s]*$/.test(text.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g,'@').replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,']').replace(/(?:^|:|,)(?:\s*\[)+/g,''))){j=eval('('+text+')');return typeof reviver==='function'?walk({'':j},''):j;}
    throw new SyntaxError('JSON.parse syntax error.');};}}());
        
    //Try to parse the JSON and throw an error if it fails
    var parseJSON = function(data) {
        try {
            return JSON.parse(data);
        } catch(e) {
            if(this.onerror) {
                this.onerror('receiveJunk', 'Received non-JSON message from the server');
            }
            
            return null;
        }
    };
    
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
                    
                    if(errorName) {
                        if(this.onerror) {
                            this.onerror(errorName, errorMessage);
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
                            if(self.onerror) self.onerror('connect', 'Could not connect');
                            self.errors++;
                            setTimeout(connect, 1000 * self.errors * self.errors);
                        }
                    }
                };
            
                // start the connection.
                socket.open("GET", self._getXHRUrl(), true);
                socket.send();
            };
            
            connect();
        },
        
        _getXHRUrl: function() {
            // use the date/time suffix for anti-caching
            var time = (new Date()).getTime();
            
            if(this.clientId != null) {
                var queryString = "?clientId=" + this.clientId + "&" + time;
            } else {
                var queryString = "?" + time;
            }
            
            return this.url + queryString;
        },
        
        _handleMessage: function(data) {
            //Parse the response
            var json = parseJSON.bind(this)(data);
            if(!json) return false;
            
            var clientId = json.clientId;
            var payload = json.payload;
            
            if(clientId != undefined) {
                this.clientId = clientId;
            } else if(payload != undefined && payload instanceof Array) {
                var messageHandler = this.onmessage;
                    
                if(this.onmessage) {
                    for(var i=0, len=payload.length; i<len; i++) {
                        messageHandler(payload[i]);
                    }
                }
            } else if(this.onerror) {
                this.onerror('receiveBadServerJSON', 'Received bad JSON message from the server');
            }
            
            return false;
        },
        
        //Sends a message to the server
        send: function(data) {
            var self = this;
            
            //Wait until there is a clientId before we send the message
            var lazySend = function() {
                if(self.clientId != null) {
                    var xhr = self._createXHR();
            
                    //Handles a response from the xhr object
                    xhr.onreadystatechange = function() {
                        if(xhr.readyState == 4 && (xhr.status < 200 || xhr.status > 299)) {
                            var json = parseJSON.bind(this)(xhr.responseText);
                            if(!json) return;
                            
                            var errorName = null;
                            var errorMessage = null;
                            
                            try {
                                errorName = json.payload.errorName;
                                errorMessage = json.payload.message;
                            } catch(e) {}
                            
                            if(errorName && errorMessage) {
                                if(self.onerror) self.onerror(errorName, errorMessage);
                            } else {
                                if(self.onerror) self.onerror('receiveBadServerJSON', 'Received bad JSON message from the server');
                            }
                        }
                    }
                    
                    //Send the message
                    xhr.open("POST", self._getXHRUrl(), true);
                    xhr.setRequestHeader("Content-type","application/json");
                    xhr.send(JSON.stringify(data));
                } else {
                    setTimeout(lazySend, 1);
                }
            };
            
            lazySend();
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