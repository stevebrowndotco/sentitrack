var express = require('express')
    , routes = require('./routes')
    , http = require('http')
    , path = require('path')
    , ntwitter = require('ntwitter')
    , fs = require('fs')
    , url = require('url')
    , cons = require('consolidate');

var tweetArray = [];
var realTimeArray = [];
var tweetData = {};
var results;

var twit = new ntwitter({
    consumer_key:'2BW4cCluZb9PwuUUYgnQ',
    consumer_secret:'esRGIujOnvSVGW9QZPKLLMbq1CiEJGR1UMvqft5JIk',
    access_token_key:'21443484-jUiNRYTNPfVCWMFoLp2drlzzpZpQ1WSAbQOBpQpeQ',
    access_token_secret:'zOq88sWdJ0NNJawetp8xGlcDSO9gnjlLNcLTIbY'
});

var app = express();

var server = http.createServer(app);
var io = require('socket.io').listen(server, { log:true });

var fastTweet;

var trackKeyword = '$AAPL';

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

var MongoClient = require('mongodb').MongoClient;

var mongo = require('mongodb');

var mongoServer = new mongo.Server('localhost', 27017);
var db = new mongo.Db('storedTweets', mongoServer);

var database = new Database();

function init() {

    twit
        .verifyCredentials(function (err, data) {
            console.log("Verifying Credentials...");
            if (err) {
                console.log("Verification failed : " + err)
            } else {
                twit.stream('statuses/filter', {'track': trackKeyword},
                    function (stream) {
                        console.log('Connected to Stream API!');
                        stream.on('data', function (data) {

                            tweetArray.push(data);

                            fastTweet = data.text;

                            fs.readFile('anew.json', 'utf8', function (fileDataErr, fileData) {

                                getSentiment(data, 'valence_mean', fileData, function (tweetData) {

                                    var geoResult = null;

                                    if (data.geo) {

                                        geoResult = data.geo.coordinates;

                                    }

                                    var document = {'time':data.created_at, 'sentiment':tweetData.sentimentResult, 'geo':geoResult }

                                    database.insert(document, 'fastData');

                                });

                            });

                        });

                        fs.readFile('anew.json', 'utf8', function (fileDataErr, fileData) {

                            if (fileDataErr) {
                                return console.log(fileDataErr);
                            }

                            setInterval(function () {
                                buildTweets(fileData)
                            },30000 ); //every 30 seconds

                        });

                    });
            }
        })

}

function Database() {

    this.insert = function (document, col, callback) {

        MongoClient.connect("mongodb://localhost:27017/storedTweets", function (err, db) {

            if (err) {
                return console.dir(err);
            }

            var collection = db.collection(col);

            collection.insert(document, {capped:true, size:99999999}, function (err) {
                if (err) {
                    console.log(err)
                }
            });

            db.close();

        });

    }

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

function getSentiment(tweetData, type, fileData, callback) {

    var tweetResult = {};

    if (tweetData) {
        var stringArray = tweetData.text.split(" ");
    }

    var sentimentResult;

    results = JSON.parse(fileData);

    var matchCount = 0;
    var totalTypeResult = 0;

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

        tweetResult = {
            tweetText:tweetData.text,
            sentimentResult:sentimentResult,
            time:tweetData.created_at
        }

        callback(tweetResult);

    }
}

function buildTweets(fileData) {

    var i = 0
    var averageSentiment = []
    var total = 0

    for (; tweetArray.length > 0 && i != tweetArray.length; i++) {

        getSentiment(tweetArray[i], 'valence_mean', fileData, function (tweetData) {

            if (!isNaN(tweetData.sentimentResult) && tweetData.sentimentResult > 0) {

                averageSentiment.push(tweetData.sentimentResult);
                total += tweetData.sentimentResult;

            }

        });

    }

    if (i == (tweetArray.length) && !isNaN(total) && total > 0) {

        var averageSentimentResult = total / averageSentiment.length;

        var now = new Date().getTime();

        var document = { 'time':now, 'averageSentiment':averageSentimentResult, 'text': tweetData.text }

        database.insert(document, 'tweetData3');

    }

    tweetArray.length = 0;

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

server.listen(app.get('port'), function () {
    console.log("Express server listening on port " + app.get('port'));
});

app.get('/', routes.index);

app.get('/hashtag', function (req, res) {
    res.render('hashtag');
})

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

init();