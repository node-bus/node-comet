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

cometServer.addListener('receive', function(endpoint, clientId, json) {
    cometServer.send(clientId, json);
});

httpServer.listen(8080);