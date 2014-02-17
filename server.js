(function(){

    var express = require('express'),
        routes = require('./routes'),
        http = require('http'),
        path = require('path'),
        ntwitter = require('ntwitter'),
        MongoClient = require('mongodb').MongoClient,
        fs = require('fs'),
        cons = require('consolidate'),
        mongo = require('mongodb'),
        streamedTweetsList = [],
        twitterCredentials = {
            consumer_key:'2BW4cCluZb9PwuUUYgnQ',
            consumer_secret:'esRGIujOnvSVGW9QZPKLLMbq1CiEJGR1UMvqft5JIk',
            access_token_key:'21443484-jUiNRYTNPfVCWMFoLp2drlzzpZpQ1WSAbQOBpQpeQ',
            access_token_secret:'zOq88sWdJ0NNJawetp8xGlcDSO9gnjlLNcLTIbY'
        },
        twitter = new ntwitter(twitterCredentials),
        app = express(),
        server = http.createServer(app),
        io = require('socket.io').listen(server, { log:false }),
        trackKeyword = 'cool',
        mongoServer = new mongo.Server('localhost', 27017),
        db = new mongo.Db('storedTweets', mongoServer),
        database = new Database(),
        dataSource = 'data/anew-dataset.json',
        averageSpeed = 30000,
        events = require('events'),
        eventEmitter = new events.EventEmitter();

    app.configure(function () {
        app.set('port', process.env.PORT || 3000);
        app.set('views', __dirname + '/views');
        app.engine('html', cons.mustache);
        app.set('view engine', 'html');
        app.set('views', __dirname + '/views');
        app.use(app.router);
        app.use(express.static(__dirname + '/public'));
    });

    function init() {
        connectToTwitter(function(data) {
            console.log('Twitter Verified!');
            var endpoint = 'statuses/filter';
            var filter = {'locations':'-6.547852,49.21042,0.571289,57.527622'}
            twitterStream(endpoint, filter);
        });
    }

    function connectToTwitter(callback) {
        twitter.verifyCredentials(function (err, data) {
            console.log("Verifying Credentials...");
            if (err) console.log("Verification failed : " + err);
            else return callback(data);
        })
    }

    function twitterStream(endpoint, filter) {
        twitter.stream(endpoint, filter, onTwitterStreamOpen);
    }

    function onTwitterStreamOpen(stream) {
        console.log('Connected to Stream API!');
        stream.on('data', onTwitterStreamData);
        Helpers.readFile(dataSource, tweetListener);
    }

    function onTwitterStreamData(rawTweetData) {
        Helpers.readFile(dataSource, function(contents) {
            var sentiment = Helpers.getTweetSentiment(rawTweetData, 'valence_mean', contents); //'Valence mean' is the sentiment.
            var tweet = createTweet(rawTweetData, sentiment);
            streamedTweetsList.push(tweet);
            eventEmitter.emit('newTweet', Helpers.strencode(tweet));
        });
    }

    function createTweet(rawTweetData, sentiment) {
        var geoResult = null;
        if (rawTweetData.geo) geoResult = rawTweetData.geo.coordinates;
        return {
            'time': rawTweetData.created_at,
            'text' : rawTweetData.text,
            'sentiment': sentiment,
            'geo': geoResult
        };
    }

    function tweetListener() {
        setInterval(saveAverageTweet, averageSpeed);
    }

    function saveAverageTweet() {
        var averageTweet = getAverageTweet(streamedTweetsList);
        console.log(averageTweet);
        database.insert(averageTweet, 'tweetData3',function(){
            Helpers.emptyArray(streamedTweetsList); //Empty the tweets when successfully saved to database.
        });
    }

    function calculateTweetAverage(individualTweets) {
        var sentimentArray = [];
        for (var i = 0; i < individualTweets.length; i++) {
            if(Helpers.isNumber(individualTweets[i].sentiment)) {
                sentimentArray.push(individualTweets[i].sentiment);
            }
        }
        return Helpers.getAverage(sentimentArray);
    }

    function getAverageTweet(individualTweets) {
        var now = new Date().getTime();
        var tweetSentimentAverage = calculateTweetAverage(individualTweets);
        return {
            'time': now,
            'averageSentiment': tweetSentimentAverage
        }
    }

    function initiateClient(socket) {
        console.log(socket.id + ' connected');
        db.close();
        database.retrieve(function (collection) {
            console.log(socket.id + ' Requesting initial data');
            collection.find().sort({$natural:-1}).limit(288).toArray(function (err, results) {
                socket.emit('fullData', Helpers.strencode(results));
            });
        })
    }

    function watchTweets(trackedCollections, socket) {
        db.open(function (err) {
            if (err) throw err;
            console.log('tracking: '+trackedCollections);
            for (var i = 0; i < (trackedCollections.length);) {
                var thisCollection = trackedCollections[i];
                pushTweets(thisCollection, i, socket);
                i++;
            }
        });
        eventEmitter.on('newTweet', function(response){
            socket.emit('fastData', response);
        });
    }

    function pushTweets(thisCollection, i, socket) {
        console.log('watching' + thisCollection);
        db.collection(thisCollection, function (err, collection) {
            if (err) throw err;
            var latest = collection.find({}).sort({ $natural:-1 }).limit(1);
            latest.nextObject(function (err, doc) {
                if (err) throw err;
                var query = { _id:{ $gt:doc._id }};
                var options = { tailable:true, awaitdata:true, numberOfRetries:-1 };
                var cursor = collection.find(query, options).sort({ $natural:1 });
                (function next() {
                    console.log('found in'+thisCollection+'...'+i);
                    cursor.nextObject(function (err, message) {
                        if (err) throw err;
                        socket.emit(thisCollection, Helpers.strencode(message));
                        next();
                    });
                })();
            });
        });
    }

    io.sockets.on('connection', function (socket) {
        var trackedCollections = ['tweetData3','fastData']
        initiateClient(socket);
        watchTweets(trackedCollections, socket);
        socket.on('reconnect', function (socket) {
            console.log(socket.id + ' reconnected');
        })
        socket.on('disconnect', function (socket) {
            console.log('disconnected');
        })
    })

    var Helpers = {
        readFile: function (filepath, callback) {
            fs.readFile(filepath, 'utf8', function (fileDataErr, fileData) {
                if (fileDataErr) {
                    return console.log(fileDataErr);
                } else {
                    if (callback) return callback(fileData);
                    else return fileData;
                }
            });
        },
        getTweetSentiment: function (rawTweetData, type, contents) {
            var sentimentResult,
                results = JSON.parse(contents),
                matchCount = 0,
                totalTypeResult = 0;
            if (rawTweetData) var stringArray = rawTweetData.text.split(" ");
            for (x in stringArray) {
                var wordToCompare = stringArray[x];
                var contains = results[0].hasOwnProperty(wordToCompare);
                if (contains) {
                    matchCount++;
                    totalTypeResult = parseFloat(totalTypeResult) + (parseFloat(results[0][wordToCompare][type]));
                }
            }
            sentimentResult = totalTypeResult / matchCount;
            if (sentimentResult) {
                return sentimentResult;
            }
        },
        isNumber: function (number) {
            if(typeof number !=='undefined') {
                return true;
            } else {
                return false;
            }
        },
        getAverage: function (array) {
            var total = 0;
            for (var i = 0; i < array.length; i++) {
                total += array[i];
            }
            total = total / array.length;
            return total;
        },
        emptyArray: function (array) {
            array.length = 0;
        },
        strencode: function(data) {
            return unescape(encodeURIComponent(JSON.stringify(data)));
        },
        strdecode: function(data) {
            return JSON.parse(decodeURIComponent(escape(data)));
        }
    }

    function Database() {
        this.insert = function (document, col, callback) {
            MongoClient.connect("mongodb://localhost:27017/storedTweets", function (err, db) {
                if (err) return console.dir(err);
                var collection = db.collection(col);
                collection.insert(document, {capped: true, size: 99999999}, function (err) {
                    if (err) console.log(err);
                });
                db.close();
                callback();
            });
        },
        this.retrieve = function (callback) {
            MongoClient.connect("mongodb://localhost:27017/storedTweets", function (err, db) {
                if (err) {
                    return console.dir(err);
                }
                var collection = db.collection('tweetData3');
                callback(collection);
                db.close();
            });
        }
    }

    init();

    app.configure('development', function () {
        app.use(express.errorHandler());
    });

    app.get('/', routes.index);

    app.get('/hashtag', function (req, res) {
        res.render('hashtag');
    })

    server.listen(app.get('port'), function () {
        console.log("Express server listening on port " + app.get('port'));
    });

})();

