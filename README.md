node-comet
==========

node-comet is a comet communication library for node.js. It uses websockets,
with graceful degradation to long polling.

Setting Things Up
=================

Download the node-comet repository:

git clone git@github.com:node-bus/node-comet.git --recursive

Running the Unit Tests
======================

Run the test server:

cd node-comet/test
sudo node testServer.js

Then, navigate a browser to http://localhost:8080/

Versions (tags)
===============

* v0.1a - Initial version. Supports websockets and long polling.