#!/usr/bin/node
var http = require('http');
var feedread = require("feed-read");
var striptags = require('striptags');
var Entities = require('html-entities').XmlEntities;
var entities = new Entities();

/**
 * \brief feedly feedlyclient/client
 * \version 0.1.0
 * \date April 2016
 */
function feedlyclient() 
{
	this.ip   = 'cloud.feedly.com';
	this.port = 80;
}

/// \brief parse an RSS/Atom feed
/// \param uri defines the feed url
/// \param functor receives the news
feedlyclient.prototype.parse_feed = function(uri, locale, functor)
{
    /// \var feedread is from npm feed-read parser
    feedread(uri, function(err, articles) 
    {
        var news = [];
        for (var i in articles) {
            var text = articles[i].content;
            text = text.replace(/\n$/g, '');
            text     = text.replace(/<(?:.|\n)*?>/gm, '');  
            text     = text.replace(/&nbsp;/gi,''); 
            text     = striptags(text);
            text     = entities.decode(text);
            news.push({author: articles[i].author,
                       title : entities.decode(striptags(articles[i].title)),
                       published: articles[i].published, //.toISOString(),
                       content: text,
                       lang : locale});
        }
        functor(news);
    });
}

/// \brief create new topic
/// \param name the name of the topic
feedlyclient.prototype.search = function(query, locale, num, on_success, on_failure)
{
	var options = {
		host: this.ip,
		port: this.port,
		path: '/v3/search/feeds?query='+query+'&locale='+locale+'&count='+num,
		method: 'GET'
    };
    var self = this;

	// connection callback
	callback = function(response) {
		var buffer = '';
		response.on('data', function (chunk) {
			buffer += chunk;
		});
		response.on('end', function() 
        {
            var feeds = JSON.parse(buffer);
            // get the RSS uri for each feed
            for (var i in feeds.results) {
                if (typeof(feeds.results[i].feedId) != "undefined") {
                    // extract the uri by removing "feed/" from the string
                    var uri = feeds.results[i].feedId;
                    uri = uri.replace("feed\/", "");
                    self.parse_feed(uri, locale, function(reply) {
                        // call the on_success functor each time a news feed is received
                        on_success(reply);
                    });
                }
            }
		});
	}
	var req = http.request(options, callback);
	req.on('error', function(err) {
        on_failure(err);
	});
	req.end();
}

/// exports
module.exports = feedlyclient;
