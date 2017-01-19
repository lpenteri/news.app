#!/usr/bin/node

// news app 
var newsapp = require('./newsapp.js');

// new app
var app = new newsapp();
app.run();

// TODO: setup cleanup handler (unsubscribe and delete topic)
/// \brief process handlers (CTRL+c, Kill, Exception) cleanup
//process.stdin.resume();
//process.on('exit', exitHandler.bind(null,{cleanup:true}));
//process.on('SIGINT', exitHandler.bind(null, {exit:true}));
//process.on('uncaughtException', exitHandler.bind(null, {exit:true}));
