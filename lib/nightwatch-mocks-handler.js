var Hapi = require('hapi');
var _ = require('lodash');
var multiportState = require('./multiport-state');
var Q = require('q');
var Fs = require('fs');

function MocksHandler (options) {
  this.mocksPort = options.mocksPort;
  this.mocksHttpsPort = options.mocksHttpsPort;

  this.keyFile = options.keyFile;
  this.certFile = options.certFile;

  this.log = options.log;
  this.log('new nightwatch handler instance');

  // mock server start/stop handlers and config options
  this.mockServerPlugin = options.mockServer;
  this.startMockServerFunc = options.mockServer && options.mockServer.start;
  this.stopMockServerFunc = options.mockServer && options.mockServer.stop;

  if (this.startMockServerFunc || this.stopMockServerFunc) {
    // we are manually starting/stopping the mock server so the plugin would not have been applied
    this.mockServerPlugin = undefined;
  }
  if (options.mockServer && options.mockServer.plugin) {
    // allow for {plugin: ..., init: ...}
    this.mockServerPlugin = options.mockServer.plugin;
  }

  this.mockServerOptions = options.mockServerOptions || {
    connections: {routes: {cors: { credentials: true }}}
  };
}

_.extend(MocksHandler.prototype, {

  /**
   * Start the mock server by either using a provided plugin in the format
   * { mockServer: {plugin} } or { mockServer: { plugin: {plugin},  } }
   *
   * or started manually using start/stop async callbacks in the format
   * { mockServer: { start: func({port}), stop: ... } }
   */

  before: function (options, callback) {
    var log = this.log;
    var startServer = function (server, connectOptions, serverPlugin) {

      var deferred = Q.defer();
      server.connection(connectOptions);
      server.register(serverPlugin, function (err) {
        if (err) {
          log('Error in registering');
          log(err);
          return deferred.reject(new Error(err));
        }
        log('Registered successfully');
        server.start(function (err) {
          if (err) {
            log('Error in starting');
            log(err);
            return deferred.reject(new Error(err));
          }
          log('Started successfully');
          deferred.resolve('Started successfully');
        })
      });
      return deferred.promise;
    };

    if (this.startMockServerFunc) {
      log('manual mock server startup');
      // app specific test runner does most of the work
      this.startMockServerFunc(options, callback);
    } else if (this.mockServerPlugin) {
      log('using mock server plugin');
      // adapter does most of the work
      var mockServer = this.mockServer = new Hapi.Server(this.mockServerOptions);

      var httpConnectOptions = {
        port: this.mocksPort,
        labels: 'http'
      };

      var promises = [];
      promises.push(startServer(mockServer, httpConnectOptions,this.mockServerPlugin));

      if (this.keyFile && this.certFile) {
        var mockHttpsServer = this.mockHttpsServer = new Hapi.Server(this.mockServerOptions);
        var tls = {
          key: Fs.readFileSync(this.keyFile),
          cert: Fs.readFileSync(this.certFile)
        };
        var httpsConnectOptions = {
          port: this.mocksHttpsPort,
          labels: 'https',
          tls: tls
        };
        promises.push(startServer(mockHttpsServer, httpsConnectOptions,this.mockServerPlugin));
      }

      var startAllServers = Q.all(promises);
      startAllServers.then(function () {
        return callback(null);
      }, function (err) {
        return callback(err);
      });
    } else {
      log('no mock server setup/teardown functions provided *and* no plugin provided... not starting mock server');
      callback();
    }
  },

  /**
   * Stop the mock server
   */
  after: function (options, callback) {
    if (this.stopMockServerFunc) {
      this.stopMockServerFunc(options, callback);
    } else if (this.mockServer) {
      var self = this;
      this.mockServer.stop(function () {
        if (self.mockHttpsServer) {
          self.mockHttpsServer.stop(callback);
        } else {
          callback();
        }
      });
    } else {
      callback();
    }
  }
});

module.exports = MocksHandler;
