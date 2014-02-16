var express = require('express'),
    routes = require('./routes'),
    http = require('http'),
    path = require('path'),
    ntwitter = require('ntwitter'),
    fs = require('fs'),
    cons = require('consolidate'),
    io = require('socket.io').listen(server, { log:true }),
    MongoClient = require('mongodb').MongoClient,
    mongo = require('mongodb'),
    streamedTweetsList = [],
    tweetData = {},
    results,
    twitterCredentials = {
        consumer_key:'2BW4cCluZb9PwuUUYgnQ',
        consumer_secret:'esRGIujOnvSVGW9QZPKLLMbq1CiEJGR1UMvqft5JIk',
        access_token_key:'21443484-jUiNRYTNPfVCWMFoLp2drlzzpZpQ1WSAbQOBpQpeQ',
        access_token_secret:'zOq88sWdJ0NNJawetp8xGlcDSO9gnjlLNcLTIbY'
    },
    twitter = new ntwitter(twitterCredentials),
    app = express(),
    server = http.createServer(app),
    trackKeyword = 'cool',
    mongoServer = new mongo.Server('localhost', 27017),
    db = new mongo.Db('storedTweets', mongoServer),
    database = new Database(),
    dataSource = 'data/anew-dataset.json';

app.configure(function () {
    app.set('port', process.env.PORT || 3000);
    app.set('views', __dirname + '/views');
    app.engine('html', cons.mustache);
    app.set('view engine', 'html');
    app.set('views', __dirname + '/views');
    app.use(app.router);
    app.use(express.static(__dirname + '/public'));
});

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

function init() {
    connectToTwitter();
}

function connectToTwitter() {
    twitter.verifyCredentials(function (err, data) {
        console.log("Verifying Credentials...");
        if (err) console.log("Verification failed : " + err);
        else onTwitterVerified();
    })
}

function onTwitterVerified() {
    console.log('Twitter Verified!');
    var endpoint = 'statuses/filter';
    var filter = {'track': trackKeyword}
    twitterStream(endpoint, filter);
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
    console.log('on stream data');
    streamedTweetsList.push(rawTweetData);
    Helpers.readFile(dataSource, function(contents) {
        var sentiment = Helpers.getTweetSentiment(rawTweetData, 'valence_mean', contents); //'Valence mean' is the sentiment.
        createTweet(rawTweetData, sentiment);
    });
}

function createTweet(rawTweetData, sentiment) {
    var geoResult = null,
        tweet;
    if (rawTweetData.geo) geoResult = rawTweetData.geo.coordinates;
    tweet = {
        'time': rawTweetData.created_at,
        'text' : rawTweetData.text,
        'sentiment': sentiment,
        'geo': geoResult
    }
    console.log(tweet);
//    database.insert(tweet, 'fastData');
}

function tweetListener(contents) {
    setInterval(function(){
        buildTweets(contents)
    }, 1000);
}

function buildTweets(fileData) {
    var i = 0,
        averageSentiment = [],
        total = 0
    for (; streamedTweetsList.length > 0 && i != streamedTweetsList.length; i++) {
        Helpers.getTweetSentiment(streamedTweetsList[i], 'valence_mean', fileData, function (tweetData) {
            if (!isNaN(tweetData.sentimentResult) && tweetData.sentimentResult > 0) {
                averageSentiment.push(tweetData.sentimentResult);
                total += tweetData.sentimentResult;
            }
        });
    }
    if (i == (streamedTweetsList.length) && !isNaN(total) && total > 0) {
        var averageSentimentResult = total / averageSentiment.length,
            now = new Date().getTime(),
            document = {
                'time':now,
                'averageSentiment':averageSentimentResult,
                'text': tweetData.text
            }
        database.insert(document, 'tweetData3');
    }
    streamedTweetsList.length = 0;
}

function initiateClient(socket) {
    console.log(socket.id + ' connected');
    db.close();
    database.retrieve(function (collection) {
        console.log(socket.id + ' Requesting initial data');
            collection.find().sort({$natural:-1}).limit(288).toArray(function (err, results) {
            socket.emit('fullData', strencode(results));
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
                    socket.emit(thisCollection, strencode(message));
                    next();
                });
            })();
        });
    });

}

function strencode(data) {
    return unescape(encodeURIComponent(JSON.stringify(data)));
}

function strdecode(data) {
    return JSON.parse(decodeURIComponent(escape(data)));
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
    }
}

function Database() {
    this.insert = function (document, col) {
        MongoClient.connect("mongodb://localhost:27017/storedTweets", function (err, db) {
            if (err) return console.dir(err);
            var collection = db.collection(col);
            collection.insert(document, {capped: true, size: 99999999}, function (err) {
                if (err) console.log(err);
            });
            db.close();
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