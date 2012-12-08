
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
 , cons = require('consolidate');

 var app = express();

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
  app.use(express.static(path.join(__dirname, 'public')));
});

 app.configure('development', function(){
  app.use(express.errorHandler());
});

  /**
   * Above this line are Express Defaults.
   */

   app.get('/', routes.index);
   
   var results;
   
   // This function analyses a string for words and compares them against the anew dataset
   function getSentiment(string, type, callback) {
   
   //Separate words in string to array
   
   var stringArray = string.split(" ");
   var sentimentResult;
   
   // For each word in string, compare with ANEW Dataset
   	fs.readFile('anew.json', 'utf8', function (err,data) {
   	
   	  if (err) {
	    return console.log(err);
	  }
	  
	  results = JSON.parse(data);
	  
	  var matchCount = 0;
	  var totalTypeResult = 0;
   	
   	for(x in stringArray) {
   	
   	  var wordToCompare = stringArray[x];
	  var contains = results[0].hasOwnProperty(wordToCompare);
	  if (contains) {
	      console.log(wordToCompare + ':' + parseFloat(results[0][wordToCompare][type]) )
		  matchCount++;
		  totalTypeResult = parseFloat(totalTypeResult)+(parseFloat(results[0][wordToCompare][type]));
	  }

   	}
   	  //The money shot
   	  sentimentResult = totalTypeResult / matchCount;
   	  
   	  //Output the result
   	  
   	  if (sentimentResult) {
 	  	  console.log('Tweet Content:')   	 
		  console.log(string);
 	  	  console.log('Tweet Happiness Rating')   	 
		  console.log(parseFloat(sentimentResult).toFixed(2))
		  console.log('======================================');
   	  }

   	
	});
	

   }

/*  app.get('/hashtag', function(req, res){ */


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

   twit
   .verifyCredentials(function (err, data) {
    console.log("Verifying Credentials...");
    if(err)
      console.log("Verification failed : " + err)
  })
   .stream('statuses/filter', {'track':'cheese' },
    function (stream) {
	  stream.on('data', function (data) { 
	  
	   	var anew = getSentiment(data.text,'valence_mean');
		  
	  });
    });
/*  }); */

app.get('/hashtag', function(req, res){
  res.render('hashtag', {
    title: 'Welcome to Stock Market Predictor'
  });
})



http.createServer(app).listen(app.get('port'), function(){
  console.log("Express server listening on port " + app.get('port'));
});

