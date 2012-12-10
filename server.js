
/**
 * Module dependencies.
 Added
 1. ntwitter - package for using Twitter API
 2. url - used to parse out different parts of URLs
 */
 
var express = require('express')
 , routes = require('./routes')
 , http = require('http')
 , path = require('path')
 , ntwitter = require('ntwitter')
 , fs = require('fs')
 , url = require('url')
 , cons = require('consolidate')
 
var tweetArray = [];
var tweetData = {};


var app = express();
 
var server = http.createServer(app);
var io = require('socket.io').listen(server, { log: true });

app.configure(function(){
    app.set('port', process.env.PORT || 3000);
    app.set('views', __dirname + '/views');
    app.engine('html', cons.mustache);
    app.set('view engine', 'html');
    app.set('views', __dirname + '/views');
    app.use(express.favicon());
    app.use(express.logger('dev'));
    app.use(express.bodyParser());
    app.use(express.methodOverride());
    app.use(express.cookieParser('secretsession'));
    app.use(express.session());
    app.use(app.router);
    app.use(express.static(__dirname + '/public'));
});

 app.configure('development', function(){
  app.use(express.errorHandler());
});


var MongoClient = require('mongodb').MongoClient;
var database = new Database();
var socketHandler = new SocketHandler();


function init() {

  console.log("Entering Single User Example...");

  /* Be sure to include all 4 tokens.
   * Default keys don't work. I am leaving them to make it easier to compare to screenshots found at
   * https://github.com/drouillard/sample-ntwitter
   * NOTE: In a real application do not embedd your keys into the source code
   */
   var twit = new ntwitter({
    consumer_key: '2BW4cCluZb9PwuUUYgnQ',
    consumer_secret: 'esRGIujOnvSVGW9QZPKLLMbq1CiEJGR1UMvqft5JIk',
    access_token_key: '21443484-jUiNRYTNPfVCWMFoLp2drlzzpZpQ1WSAbQOBpQpeQ',
    access_token_secret: 'zOq88sWdJ0NNJawetp8xGlcDSO9gnjlLNcLTIbY'
  });
  
   database.retrieve(function(collection){
      
   })
   
   twit
   .verifyCredentials(function (err, data) {
    console.log("Verifying Credentials...");
    if(err) {
       console.log("Verification failed : " + err)
    }

    })
    
    .stream('statuses/filter', {'locations': '-6.547852,49.21042,0.571289,57.527622'},
    function (stream) {
      console.log('Connected to Stream API!');
      
      stream.on('data', function (data) {
        tweetArray.push(data);
      });
          
      fs.readFile('anew.json', 'utf8', function (fileDataErr,fileData) {
      
              if (fileDataErr) {
                  return console.log(fileDataErr); 
              }
      
          setInterval(function() { buildTweets(fileData) }, 10000); //every 30 seconds
          
      });
              
    });
           
}
   
// Connect to the db
function Database() {

  this.insert = function(tweetObject, now, averageSentimentResult, callback) {
  
      MongoClient.connect("mongodb://localhost:27017/storedTweets", function(err, db) {
      
          if(err) { return console.dir(err); }
          
          var collection = db.collection('tweetData');
          collection.insert({'tweetGroup' : tweetObject, time: now, 'averageSentiment' : averageSentimentResult}, function(err){
              if(err) { console.log(err) }
          });
          
          callback(collection);
      
      });

  }
  
  this.retrieve = function(callback) {
  
      MongoClient.connect("mongodb://localhost:27017/storedTweets", function(err, db) {
      
          if(err) { return console.dir(err); }
          
          var collection = db.collection('tweetData');
          
          callback(collection);
      
      });
      
  }

 }
 
 function SocketHandler() {
    
    this.emit = function(item) {
    
        console.log('sending to page');
        io.sockets.on('connection', function (socket) { //This needs to be always on! HAVE THE SOCKETS ON EVENT LIKE AN INIT!!
            socket.emit('chart', item); 
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
       
      if(tweetData) {
           var stringArray = tweetData.text.split(" ");
      }
    
       var sentimentResult;
   
   // For each word in string, compare with ANEW Dataset

      results = JSON.parse(fileData);
      
      var matchCount = 0;
      var totalTypeResult = 0;
    
      for(x in stringArray) {
    
          var wordToCompare = stringArray[x];
          var contains = results[0].hasOwnProperty(wordToCompare);
          if (contains) {
              matchCount++;
              totalTypeResult = parseFloat(totalTypeResult)+(parseFloat(results[0][wordToCompare][type]));
          }
      }

      //Output the result
      
      sentimentResult = totalTypeResult / matchCount;
      if (sentimentResult) {

      tweetResult = {
          tweetText : tweetData.text,
          sentimentResult: sentimentResult,
          time: tweetData.created_at
      }
  
      callback(tweetResult);
      
      } 
   }
   
function buildTweets(fileData) {

    var i =0
    var averageSentiment = []
    var total = 0
    var tweetObject = []

    for(; tweetArray.length > 0 && i!=tweetArray.length; i++) { 

            getSentiment(tweetArray[i],'valence_mean', fileData, function(tweetData) {
                
                if (!isNaN(tweetData.sentimentResult) && tweetData.sentimentResult > 0) {
                
                    averageSentiment.push(tweetData.sentimentResult);
                    total += tweetData.sentimentResult;
                    tweetObject.push(tweetData);
                    
                }

            });
            
    }

    if(i == (tweetArray.length) && !isNaN(total) && total > 0) {
    
        console.log('============================================') //Lets clearly debug
        
        var averageSentimentResult = total / averageSentiment.length;
        
        var now = new Date().getTime();
        
        console.log(now);
        
        database.insert(tweetObject, now, averageSentimentResult, function(collection) {
                console.log( (total / averageSentiment.length)  );
    
                var stream = collection.find().sort( { _id : -1 } ).limit(1).streamRecords();
                
                stream.on("data", function(item) {
                    socketHandler.emit(item);
                });

        });
        
    }

    //Empty the Array for next time
    tweetArray.length = 0;

}

app.get('/hashtag', function(req, res){
  res.render('hashtag', {
    title: 'Welcome to Stock Market Predictor'
  });
})

server.listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});

init();




