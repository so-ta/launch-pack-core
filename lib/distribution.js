const stream = require('stream');
const fs = require('fs');
const zlib = require('zlib');

function distributeText(text, req, res) {
  const resultStream = new stream.Readable();
  resultStream.push(text);
  resultStream.push(null);

  const acceptEncoding = req.headers['accept-encoding'] || '';
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

function distributePlainText(statusCode, text, req, res) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function findContentType(_url) {
  const types = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.woff': 'application/font-woff',
    '.ttf': 'application/x-font-ttf',
    '.otf': 'application/x-font-otf',
    '.svgf': 'image/svg+xml',
    '.eot': 'application/vnd.ms-fontobject',
    '.pdf': 'application/pdf',
  };

  const key = Object.keys(types).find(k => _url.endsWith(k));
  return key ? types[key] : 'text/plain';
}

function distributeByFilePath(filePath, req, res) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('file not found');
    return;
  }
  const contentType = findContentType(filePath);
  res.setHeader('content-type', `${contentType};`);

  const stat = fs.statSync(filePath);
  const etag = `${stat.ctimeMs}-${stat.size}`;
  res.setHeader('Etag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.end();
    return;
  }

  if (['text/html', 'text/css', 'text/javascript'].indexOf(contentType) > 0) {
    const data = fs.readFileSync(filePath);
    distributeText(data, req, res);
  } else {
    const distributeFile = fs.createReadStream(filePath);
    distributeFile.on('open', () => {
      distributeFile.pipe(res);
    });
    distributeFile.on('error', () => {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Content delivery error');
    });
  }
}

module.exports = {
  distributeText, // text系を配信する（gzip等の処理を加える）
  distributePlainText, // plainTextを配信する（ヘルスチェックや異常系）
  distributeByFilePath, // filepathからコンテンツを配信する（textファイルだった場合は圧縮する）
};
