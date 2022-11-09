const http = require('http');
const fs = require('fs');
const toRSS = require('./twitterv2_node.js');
require('dotenv').config();

const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {

  let request = new URL(req.url, `http://${req.headers.host}`);

  // //FOR DEBUGGING
  // if (request.pathname == "/api" && process.env.DEBUG === "true") {
  //   let query = decodeURIComponent(request.searchParams.toString());
  //   if (query.endsWith("=")) { query = query.substring(0, query.length - 1) }
  //   toRSS.getData(`https://api.twitter.com/${query}`).then(
  //     function (response) {
  //       res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
  //       res.write(JSON.stringify(response, null, 3));
  //       res.end();
  //     }
  //   ).catch(function (e) {
  //     console.log(e);
  //     if (e.statusCode != undefined) { e.statusCode = 502; }
  //     res.writeHead(e.statusCode, {
  //       'Content-Type': 'application/json; charset=UTF-8'
  //     });
  //     if (e instanceof String) { res.write(JSON.stringify(JSON.parse(e), null, 3)); }
  //     else { res.write(JSON.stringify(e, null, 3)); }
  //     res.end();
  //   });
  //   return;
  // }
  // //END FOR DEBUGGING

  if (request.searchParams.get("key") != process.env.key) { //if unauthorised
    res.writeHead(401, {
      'Content-Type': 'text/plain; charset=UTF-8'
    });
    res.write("403: Unauthorised.");
    res.end();
    return;
  }

  switch (request.pathname) {
    case "/rss":
      if (request.searchParams.has("action")) { // if query params available, excluding "key" param
        let URLparams = new URLSearchParams(request.search);
        if (URLparams.get("filters") === undefined) { URLparams.set("filters", "tweets,retweets,replies,attachments,text"); }
        if (URLparams.get("title") === undefined) { URLparams.set("title", "plain"); }
        toRSS.fetchRSS(URLparams).then((output) => {
          if (output.startsWith(`<?xml`)) { //if rss output
            // //TEST RSS OUTPUT
            // if (output.match(/<link>.*\/(\d*)<\/link>/)[1] === URLparams.get("q")) {
            //   res.writeHead(404, {
            //     'Content-Type': 'text/plain; charset=UTF-8'
            //   });
            //   res.write("404: listID (" + URLparams.get("q") + ") did not match!");
            //   res.end();
            //   return;
            // }
            // let outputFilters = output.match(/<title>.* with (.*)<\/title>/)[1].split(",").map((v)=>{return v.trim().toLowerCase()});

            // if(URLparams.get("filters").split(",").every((v)=>{
            //   return outputFilters.indexOf(v) > -1;
            // })){
            //   res.writeHead(404, {
            //     'Content-Type': 'text/plain; charset=UTF-8'
            //   });
            //   res.write("404: filters (" + URLparams.get("filters") + ") did not match!");
            //   res.end();
            //   return;
            // }
            // //END TEST RSS OUTPUT
            res.writeHead(200, {
              'Content-Type': 'application/rss+xml; charset=UTF-8'
            });
          } else { //if invalid output
            res.writeHead(404, {
              'Content-Type': 'text/plain; charset=UTF-8'
            });
            res.write("404: ");
          }
          res.write(output);
          res.end();
        }).catch((e) => {
          console.log(e);
          if (e.statusCode != undefined) { e.statusCode = 502; }
          res.writeHead(e.statusCode, {
            'Content-Type': 'application/json; charset=UTF-8'
          });
          if (e instanceof String) { res.write(JSON.stringify(JSON.parse(e), null, 3)); }
          else { res.write(JSON.stringify(e, null, 3)); }
          res.end();
        });
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.write("404: Page not found.");
        res.end();
      }
      break;
    case "/":
      //return homepage
      fs.readFile(__dirname + "/index.html", function (error, data) {
        if (error) {
          res.writeHead(404);
          res.write(error);
          res.end();
        } else {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=UTF-8'
          });
          res.write(data);
          res.end();
        }
      });

      break;
    default:
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
      res.write("404: Page not found.");
      res.end();
      break;
  }
  return;
});

server.listen(port, () => {
  console.log(`Server running on port ${port}!`);
});