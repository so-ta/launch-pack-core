'use strict';

const stream = require('stream');
const fs = require('fs');
const zlib = require('zlib');

/* text系を配信する（gzip等の処理を加える） */
exports.textDistribute = textDistribute;
/* filepathからコンテンツを配信する（textファイルだった場合は圧縮する） */
exports.distributeByFilePath = distributeByFilePath;

function textDistribute(text, req, res) {
  let resultStream = new stream.Readable;
  resultStream._read = function noop() {
  };
  resultStream.push(text);
  resultStream.push(null);

  let acceptEncoding = req.headers['accept-encoding'] || "";
  if (acceptEncoding.match(/\bgzip\b/)) {
    res.setHeader('content-encoding', 'gzip');
    resultStream.pipe(zlib.createGzip()).pipe(res);
  } else if (acceptEncoding.match(/\bdeflate\b/)) {
    res.setHeader('content-encoding', 'deflate');
    resultStream.pipe(zlib.createDeflate()).pipe(res);
  } else {
    resultStream.pipe(res);
  }
}


function findContentType(_url) {
  let types = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".png": "image/png",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".woff": "application/font-woff",
    ".ttf": "application/x-font-ttf",
    ".otf": "application/x-font-otf",
    ".svgf": "image/svg+xml",
    ".eot": "application/vnd.ms-fontobject",
    ".pdf": "application/pdf"
  };
  for (let key in types) {
    if (_url.endsWith(key)) {
      return types[key];
    }
  }
  return "text/plain";
}

function distributeByFilePath(filePath, req, res) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(500, {'Content-Type': 'text/plain'});
    res.end('file not found');
    return;
  }
  let contentType = findContentType(filePath);
  res.setHeader('content-type', contentType + ';');

  let stat = fs.statSync(filePath);
  let etag = stat.ctimeMs + '-' + stat.size;
  res.setHeader('Etag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.end();
    return;
  }

  if (["text/html", "text/css", "text/javascript"].indexOf(contentType) > 0) {
    let data = fs.readFileSync(filePath);
    textDistribute(data, req, res);
  } else {
    let distributeFile = fs.createReadStream(filePath);
    distributeFile.on('open', function () {
      distributeFile.pipe(res);
    });
    distributeFile.on('error', function () {
      res.writeHead(500, {'Content-Type': 'text/plain'});
      res.end('Content delivery error');
    });
  }
}
