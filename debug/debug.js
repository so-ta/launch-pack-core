function syntaxHighlight(json) {
  if (typeof json != 'string') {
    json = JSON.stringify(json, undefined, 2);
  }
  json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    var cls = 'number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'key';
      } else {
        cls = 'string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'boolean';
    } else if (/null/.test(match)) {
      cls = 'null';
    }
    return '<span class="' + cls + '">' + match + '</span>';
  });
}

$(function () {
  var socketio = io.connect('http://localhost:1338');
  socketio.on("addAccessLog", function (data) {
    var rand = ("" + Math.random()).replace(".", "");

    console.log("add access log");
    console.log(data);
    let tableHtml = '';
    tableHtml += '<td>' + data.timestamp + '</td>';
    tableHtml += '<td>' + data.method + '</td>';
    tableHtml += '<td>' + data.reqUrl + '</td>';
    tableHtml += '<td>' + data.statusCode + '</td>';

    if ("apiReq" in data) {
      tableHtml += '<td>'
        + data.apiReq.requestMethod + ' ' + data.apiReq.url + '<br>'
        + '<div class="show-toggle-key" style="cursor: pointer;color: blue;text-decoration: underline;">Params</div>'
        + '<div class="show-toggle" style="display: none;">' + data.apiReq.params + '</div>'
        + '<div class="show-toggle-key" style="cursor: pointer;color: blue;text-decoration: underline;">Cookies</div>'
        + '<div class="show-toggle" style="display: none;">' + data.apiReq.cookies.replace(/;/g, ';<br>') + '</div>'
        + '</td>';
    } else {
      tableHtml += "<td>-</td>"
    }

    tableHtml += '<td><div id="json-' + rand + '" style="margin-left: 16px;"></div></td>';
    console.log("new JsonEditor('#json-'+rand, JSON.parse(data.contentJson))");
    tableHtml += '<td>' + data.performanceTime + 'ms</td>';

    tableHtml = '<tr>' + tableHtml + '</tr>';
    $('#table').append(tableHtml)

    $('.show-toggle-key').off('click');
    $('.show-toggle-key').on('click', function () {
      var index = $('.show-toggle-key').index(this);
      $('.show-toggle').eq(index).toggle();
    });

    if (data.contentJson) {
      $('#json-' + rand).jsonViewer(JSON.parse(data.contentJson), {collapsed: true})
    }

  });
});
