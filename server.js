var express = require('express')
    , routes = require('./routes')
    , http = require('http')
    , path = require('path')
    , ntwitter = require('ntwitter')
    , fs = require('fs')
    , url = require('url')
    , cons = require('consolidate');

var tweetArray = [];
var tweetData = {};

var twit = new ntwitter({
    consumer_key:'2BW4cCluZb9PwuUUYgnQ',
    consumer_secret:'esRGIujOnvSVGW9QZPKLLMbq1CiEJGR1UMvqft5JIk',
    access_token_key:'21443484-jUiNRYTNPfVCWMFoLp2drlzzpZpQ1WSAbQOBpQpeQ',
    access_token_secret:'zOq88sWdJ0NNJawetp8xGlcDSO9gnjlLNcLTIbY'
});

var app = express();

var server = http.createServer(app);
var io = require('socket.io').listen(server, { log:false });

app.configure(function () {
    app.set('port', process.env.PORT || 3000);
    app.set('views', __dirname + '/views');
    app.engine('html', cons.mustache);
    app.set('view engine', 'html');
    app.set('views', __dirname + '/views');
//    app.use(express.favicon());
    app.use(express.logger('dev'));
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(express.cookieParser('secretsession'));
    app.use(express.session());
    app.use(app.router);
    app.use(express.static(__dirname + '/public'));
});

app.configure('development', function () {
    app.use(express.errorHandler());
});

//

var MongoClient = require('mongodb').MongoClient;

//

var mongo = require('mongodb');

var mongoServer = new mongo.Server('localhost', 27017);
var db = new mongo.Db('storedTweets', mongoServer);

//

var database = new Database();

function init() {

    twit
        .verifyCredentials(function (err, data) {
            console.log("Verifying Credentials...");
            if (err) {
                console.log("Verification failed : " + err)
            } else {
                twit.stream('statuses/filter', {'locations':'-6.547852,49.21042,0.571289,57.527622'},
                    function (stream) {
                        console.log('Connected to Stream API!');
                        stream.on('data', function (data) {
                            tweetArray.push(data);
                        });

                        fs.readFile('anew.json', 'utf8', function (fileDataErr, fileData) {

                            if (fileDataErr) {
                                return console.log(fileDataErr);
                            }

                            setInterval(function () {
                                buildTweets(fileData)
                            }, 30000); //every 30 seconds

                        });

                    });
            }
        })

}

// Connect to the db
function Database() {

    this.insert = function (tweetObject, now, averageSentimentResult, callback) {

        MongoClient.connect("mongodb://localhost:27017/storedTweets", function (err, db) {

            if (err) {
                return console.dir(err);
            }

            var collection = db.collection('tweetData');

            collection.insert({'tweetGroup':tweetObject, time:now, 'averageSentiment':averageSentimentResult}, {capped:true, size:100000}, function (err) {
                if (err) {
                    console.log(err)
                }
            });

            console.log('Saved '+ tweetObject.length + ' tweets to the database');

            db.close();

        });

    }

    this.retrieve = function (callback) {

        MongoClient.connect("mongodb://localhost:27017/storedTweets", function (err, db) {

            if (err) {
                return console.dir(err);
            }

            var collection = db.collection('tweetData');

            callback(collection);

            db.close();

        });

    }

}

/**
 * Above this line are Express Defaults.
 */

app.get('/', routes.index);

var results;

// This function analyses a string for words and compares them against the anew dataset
function getSentiment(tweetData, type, fileData, callback) {

    var tweetResult = {};

    //Separate words in string to array

    if (tweetData) {
        var stringArray = tweetData.text.split(" ");
    }

    var sentimentResult;

    // For each word in string, compare with ANEW Dataset

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

    //Output the result

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
    var tweetObject = []

    for (; tweetArray.length > 0 && i != tweetArray.length; i++) {

        getSentiment(tweetArray[i], 'valence_mean', fileData, function (tweetData) {

            if (!isNaN(tweetData.sentimentResult) && tweetData.sentimentResult > 0) {

                averageSentiment.push(tweetData.sentimentResult);
                total += tweetData.sentimentResult;
                tweetObject.push(tweetData);

            }

        });

    }

    if (i == (tweetArray.length) && !isNaN(total) && total > 0) {

        var averageSentimentResult = total / averageSentiment.length;

        var now = new Date().getTime();

        console.log(tweetObject.length + ' tweets found')


        database.insert(tweetObject, now, averageSentimentResult);

    }

    //Empty the Array for next time
    tweetArray.length = 0;

}

app.get('/hashtag', function (req, res) {
    res.render('hashtag');
})

io.sockets.on('connection', function(socket) {

    console.log(socket.id+' connected');

    db.close(); //Close if client is reconnected to avoid crashes!

    database.retrieve(function(collection){

        console.log(socket.id + ' Requesting initial data');

        collection.find().toArray(function(err, results){
            socket.emit('fullData', strencode(results));

        });

    })

    // Check for changes to database and push
    db.open(function(err) {

        console.log('opening tweetData collection');
        if (err) throw err;

        db.collection('tweetData', function(err, collection) {
            if (err) throw err;

            var latest = collection.find({}).sort({ $natural: -1 }).limit(1);

            latest.nextObject(function(err, doc) {
                if (err) throw err;

                var query = { _id: { $gt: doc._id }};

                var options = { tailable: true, awaitdata: true, numberOfRetries: -1 };
                var cursor = collection.find(query, options).sort({ $natural: 1 });

                (function next() {
                    cursor.nextObject(function(err, message) {
                        if (err) throw err;
                          console.log('sending '+ message.tweetGroup.length +' to '+socket.id);
                          socket.emit('chart', strencode(message));
                        next();
                    });
                })();
            });
        });


    });

    socket.on('reconnect', function(socket){

        console.log(socket.id+' reconnected');

    })

    socket.on('disconnect', function(socket){

        console.log('disconnected');

    })

})

server.listen(app.get('port'), function () {
    console.log("Express server listening on port " + app.get('port'));
});

var escapable = /[\x00-\x1f\ud800-\udfff\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufff0-\uffff]/g;

function filterUnicode(quoted){

    escapable.lastIndex = 0;
    if( !escapable.test(quoted)) return quoted;

    return quoted.replace( escapable, function(a){
        return '';
    });
}

function strencode( data ) {
    return unescape( encodeURIComponent( JSON.stringify( data ) ) );
}

function strdecode( data ) {
    return JSON.parse( decodeURIComponent( escape ( data ) ) );
}

init();