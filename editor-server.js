// Test case editor server - helps edit test cases
// Setup all required packages
'use strict';
// Object definition for holding Complex Paragraphs - object factory
var complexParagraph = function() { return Object.create({ id : "",
        text : "", 
        steps: [],
        index : 0,
        add : function(id, text) {
        this.id = id;
        this.text = text;
        let first = true;
        for (let step of text.split("/step ")) {
          if (first) { 
            first = false;
            continue;
          }
          step = step.replace(/\\step */, "");
          this.steps.push({ line : step, bullets : step.split("/bullet ")});
          this.steps[this.steps.length-1].bullets.pop(0);
        }
        for (let step of this.steps) {
          for (let bullet of step.bullets) {
            bullet = bullet.replace(/\\bullet */,"");
          }
        }
      },
        reset : function() {
        this.index = 0;
      },
        getStep : function() {
        return this.steps[this.index++];
      },
        toString : function() {
        let fullParagraph = "";
        for (let step of this.steps) {
          fullParagraph += step.line + "\n";
          let first = true;
          for (let bullet of step.bullets) {
            if (first) {
              first = false;
              continue;
            }
            fullParagraph += "    " + bullet + "\n";
          }
        }
        return fullParagraph;
      }
    });};

var express = require("express");
var bodyParser = require("body-parser");
var fs = require("fs");
var jsdom = require("jsdom");
var readLine = require("readline");
var WebSocketServer = require("ws").Server;
var spawn = require("child_process").spawn;
var execSync = require("child_process").execSync;
var convertDbToJSON = require("./DbUtilities").convertDbToJSON;
var convertJSONToDb = require("./DbUtilities").convertJSONToDb;
// Read main html page - this will be parsed later
let mainPageContents = fs.readFileSync("./index.html");
// Read log entry page - this will be reissued later
let logEntryContents = fs.readFileSync("./log_entry.html");
// Read test case template
let editingTestCaseContents = fs.readFileSync("./test_case.html");
// create an express server to make a static file server
var app = express();
// initialize global information
var childProcess = null;
execSync("touch updated");
var statTime = [{Path: "updated", Time: fs.statSync("updated").ctime}];
var target;
var relay = [];
var jsonImages = [];
var fullBuffer = "";
var jsonFullBuffer;
var jsonDb = null;
var fileHandles = [];
var testDocumentID = 0;

// start a Web Socket Server
//var wss = new WebSocketServer({port: process.env.PORT || 3001});
// above didn't work on Heroku
// check for changes to the test database every second
setInterval(function(){
    let changed = false;
    for (let entry of statTime) {
      changed |= fs.statSync(entry.Path).ctime.valueOf() != entry.Time.valueOf();
      entry.Time = fs.statSync(entry.Path).ctime;
    }
    if (changed) { // if any of the files changed, rebuild the section and trace tables
      //execSync('./buildHTMLSection '+ target.slice(1));
      execSync('./buildHTMLBook book');
      execSync('./buildHTMLTraceTables book');
      for (let connection of relay) {
        connection.send("refresh");
        console.log("sending refresh to the client");
      }
    }
  },1000);
// if the express server is contacted, look at the request and build a response or
// forward the request to the standard server behavior.
app.use(bodyParser.urlencoded({extended: true}));
app.post('/log_entry.html', function(request, response, next){
    let appendData = "ID:" + request.body.testID + "\n";
    appendData += "Test Start Time: " + request.body.testStartTime +"\n";
    appendData += "Log data:\n" + request.body.testData.replace(/[\r]+/g,"") + "\n";
    appendData += "Results: " + request.body.results + "\n";
    appendData += "Test End Time: " + request.body.testEndTime + "\n";
    appendData += "Tester: " + request.body.tester + "\n";
    fs.appendFileSync("./TEST.LOG",appendData);
    let dom = new jsdom.JSDOM(logEntryContents);
    response.send(dom.serialize());
  });
app.post('/test_case*', function(request, response, next){
    console.log("processing a post of an updated test case");
    let category = request.body.testCaseID.slice(0, request.body.testCaseID.indexOf("-"));
    console.log(request.body.title);
    jsonDb[category]['testDbID'][request.body.testCaseID] = request.body.title;
    console.log(request.body.setup);
    jsonDb[category]['testDbPre'][request.body.testCaseID] = request.body.setup.replace(/\r\n/g,"/hr");
    console.log(request.body.objective);
    jsonDb[category]['testDbObjective'][request.body.testCaseID] = request.body.objective.replace(/\r\n/g,"");
    let line = 1;
    let bulletLine = 1;
    let procedures = "";
    while ("stepLine" + line in request.body) {
      if ("step" + line in request.body) {
        procedures += "/step " + request.body["stepLine" + line].replace(/\r\n/g,"") + "\\step ";
      }
      line++;
      while ("bulletLine" + bulletLine in request.body) {
        if ("bullet" + bulletLine in request.body) {
          procedures += "/bullet " + request.body["bulletLine" + bulletLine].replace(/\r\n/g,"") + "\\bullet ";
        }
        bulletLine++;
      }
    }
    console.log(procedures);
    jsonDb[category]['testDbProcedures'][request.body.testCaseID] = procedures;
    console.log(request.body.expectedResults);
    jsonDb[category]['testDbExpectedResults'][request.body.testCaseID] = request.body.expectedResults.replace(/\r\n/g,"");
    console.log(request.body.results);
    jsonDb[category]['testDbResults'][request.body.testCaseID] = request.body.results;
    console.log(request.body.cleanup);
    jsonDb[category]['testDbPost'][request.body.testCaseID] = request.body.cleanup.replace(/\r\n/g,"/hr");
    console.log(request.body.requirements);
    jsonDb[category]['requirements'][request.body.testCaseID] = request.body.requirements.replace(/\r\n/g,"");
    convertJSONToDb(jsonDb, function() {
        execSync("touch updated")});
    response.set("Connection","close");
    response.status(200);
    response.send("");
    //execSync("touch updated");
  });
app.get("/", function(request, response, next) {
    // this is the main page so build replacement DOM
    // that has the sections available to edit
    let files = fs.readdirSync("./");
    let dom = new jsdom.JSDOM(mainPageContents);
    let document = dom.window.document;
    let insertionPoint = document.querySelector("#list");
    for (let file of files) {
      if (file.indexOf("_toc") >= 0) {
        let element = document.createElement("a");
        element.setAttribute("href",file);
        element.innerHTML = file;
        let listElement = document.createElement("li");
        listElement.appendChild(element);
        insertionPoint.appendChild(listElement);
      }
    }
    response.send(dom.serialize());
  });
app.get("/*/*.html", function(request, response, next) {
    // found a terminal html file that a user wants (may want) to edit, bring up an editor
    // for the database and tailor the test case file so it can refresh
    testDocumentID++;
    let fillForm = function() {
      let dom = new jsdom.JSDOM(editingTestCaseContents);
      let document = dom.window.document;
      let insertionPoint = document.querySelector("#testCaseID");
      let category = request.url.slice(request.url.lastIndexOf("/")+1,request.url.indexOf("-"));
      let theCase = request.url.slice(request.url.lastIndexOf("/")+1,request.url.indexOf(".html"));
      //console.log(insertionPoint);
      //console.log(theCase);
      //console.log(jsonDb[category]["testDbID"][theCase]);
      //console.log(jsonDb[category]["testDbObjective"]);
      insertionPoint.innerHTML = theCase;
      insertionPoint = document.querySelector("#title");
      insertionPoint.innerHTML = jsonDb[category]['testDbID'][theCase];
      insertionPoint = document.querySelector("#objective");
      insertionPoint.innerHTML = jsonDb[category]['testDbObjective'][theCase];
      insertionPoint = document.querySelector("#setup");
      insertionPoint.innerHTML = jsonDb[category]['testDbPre'][theCase];
      insertionPoint = document.querySelector("#procedures");
      //insertionPoint.innerHTML = jsonDb[category]['testDbProcedures'][theCase];
      var actions = complexParagraph();
      actions.add(theCase, jsonDb[category]['testDbProcedures'][theCase]);
      //insertionPoint.innerHTML = actions.toString();
      let step;
      insertionPoint = document.querySelector("#steps");
      let lineNumber = 1;
      while ((step = actions.getStep()) != undefined) {
        let div = document.createElement("div");
        let box = document.createElement("input");
        box.setAttribute("type", "checkbox");
        box.setAttribute("value", "keepStepLine" + lineNumber);
        box.setAttribute("name", "step" + lineNumber);
        box.setAttribute("checked","");
        div.appendChild(box);
        let stepLine = document.createElement("textArea");
        stepLine.innerHTML = step.line;
        stepLine.setAttribute("name", "stepLine" + lineNumber++);
        stepLine.setAttribute("rows", "2");
        stepLine.setAttribute("cols", "80");
        div.appendChild(stepLine);
        insertionPoint.appendChild(div);
      }
      insertionPoint = document.querySelector("#expectedResults");
      insertionPoint.innerHTML = jsonDb[category]['testDbExpectedResults'][theCase];
      insertionPoint = document.querySelector("#results");
      insertionPoint.innerHTML = jsonDb[category]['testDbResults'][theCase];
      insertionPoint = document.querySelector("#cleanup");
      insertionPoint.innerHTML = jsonDb[category]['testDbPost'][theCase];
      insertionPoint = document.querySelector("#requirements");
      insertionPoint.innerHTML = jsonDb[category]['requirements'][theCase];
      fs.writeFileSync("./test_case_" + testDocumentID + ".html", dom.serialize());
    }
    let testCaseContents = fs.readFileSync("./"+request.url);
    let dom = new jsdom.JSDOM(testCaseContents);
    let document = dom.window.document;
    let insertionPoint = document.querySelector("body");
    let scriptElement = document.createElement("script");
    scriptElement.setAttribute("type","text/javascript");
    let adaptHTTP = process.env.PORT ? "var browser = window.open(\"https://\" + hostName + \"/test_case_" + testDocumentID +".html\");" :
      "var browser = window.open(\"http://\" + hostName + \":3000/test_case_" + testDocumentID +".html\");";
    let adaptWSS = process.env.PORT ? "var ws = new WebSocket(\"wss://\" + hostName + \":" + process.env.PORT + "\");" :
      //"var ws = new WebSocket(\"ws://\" + hostName + \":3000\");";
    	"var ws = new WebSocket(location.origin.replace(\"http\", \"ws\"));";

    scriptElement.innerHTML = 
      "var hostName = location.hostname;" + adaptHTTP + adaptWSS +
      "console.log(\"attempt for client connection made\");" +
      "ws.onmessage = function(message) {"+
      " console.log(\"got this message:\" + message.data);" + 
      " if (message.data === \"refresh\") {" +
      "  window.location.reload();};" +
      " };";
    insertionPoint.appendChild(scriptElement);
    response.send(dom.serialize());
    if (jsonDb == null) {
      convertDbToJSON('book', function (database) {
          jsonDb = database;
          //console.log(jsonDb);
          fillForm();
        });
    } else {
      fillForm();
    }
    return;
  });
app.get("*", function(request, response, next) {
    console.log("fell into default get");
    console.log(request.url);
    console.log(request.method);
    next();
  });
app.post("*", function(request, response, next) {
    console.log("fell into default post");
    console.log(request.url);
    console.log(request.method);
    next();
  });
app.use(express.static("./"));
//var ws = new WebSocketServer({server: app.listen(process.env.PORT || 3000), path: "/"});
var ws = new WebSocketServer({server: app.listen(process.env.PORT || 3000)});

ws.on("connection", function(connection) {
    relay.push(connection); // store for communication
    console.log("web socket connection made at server from HTML client page");
    connection.send("connected");
    connection.on("message", function (message) {
        if (message === "exit") {
          relay.splice(relay.indexOf(connection), 1);
          connection.close();
        }
      });
    connection.on("close", function(message) {
        relay.splice(relay.indexOf(connection), 1);
        connection.close();
        console.log("closing a connection");
      });
  });

//app.listen(process.env.PORT || 3000);
console.log("Editor server is listening");
