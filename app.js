const http = require('http');
const fs = require('fs');
const toRSS = require('./twitterv2_node.js');
require('dotenv').config();

const hostname = '192.168.0.101';
const port = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  let request = new URL(req.url, `http://${req.headers.host}`);
  console.log(request.toString());

  //FOR DEBUGGING
  if (request.pathname == "/api") {
    let query = decodeURIComponent(request.searchParams.toString());
    if (query.endsWith("=")) { query = query.substring(0, query.length - 1) }
    toRSS.getData(`https://api.twitter.com/${query}`).then(
      function (response) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=UTF-8' });
        res.write(JSON.stringify(response, null, 3));
        res.end();
      }
    ).catch(function (e) {
      res.writeHead(e.statusCode, {
        'Content-Type': 'application/json; charset=UTF-8'
      });
      res.write(JSON.stringify(JSON.parse(e.data), null, 3));
      res.end();
    });
    return;
  }
  //END FOR DEBUGGING

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
        let output;
        try {
          output = await toRSS.fetchRSS(new URLSearchParams(request.search));
        } catch (e) {
          res.writeHead(e.statusCode, {
            'Content-Type': 'application/json; charset=UTF-8'
          });
          res.write(JSON.stringify(JSON.parse(e.data), null, 3));
          res.end();
          break;
        }
        if (output.startsWith(`<?xml`)) { //if rss output
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
            'Content-Type': 'text/plain; charset=UTF-8'
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

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});