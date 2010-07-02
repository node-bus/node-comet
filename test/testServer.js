#!/usr/local/bin/node
var comet = require('../src/comet.server'),
    http = require('http'),
    url = require('url'),
    sys = require('sys'),
    router = require('./lib/node-router');

var httpServer = http.createServer();
var cometServer = new comet.CometServer(httpServer, "/nodecomet");
var dirHandler = router.staticDirHandler("../", "", ["index.html"]);

httpServer.addListener('request', function (request, response) {
    if(!/\/nodecomet/.test(request.url)) {
        dirHandler(request, response);
    }
});

cometServer.addListener('connect', function(endpoint, clientId) {
    sys.puts("Client " + clientId + " connected");
});

cometServer.addListener('close', function(endpoint, clientId) {
    sys.puts("Client " + clientId + " disconnected");
});

cometServer.addListener('receive', function(endpoint, clientId, json) {
    sys.puts("Sending to " + clientId + ": " + JSON.stringify(json));
    cometServer.send(clientId, json);
});

cometServer.addListener('receiveJunk', function(endpoint, clientId, junk) {
    sys.puts("Received junk from " + clientId + ": " + junk);
});

httpServer.listen(8080);