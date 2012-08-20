function _testArray() {
    return [1, 0, [7, 77, 777].map(function(e) { return [1, e]; })];
}

function logString(e) {
    console.log('logString:' + e);
    return [1, 0];
}
function logDouble(e) {
    console.log('logDouble:' + e);
    return logString(e);
}
function _arrayMap(fn, arr) {
    console.log('arraymap:' + arr);
    return [1, 0, arr.map(function(e) {
			      var p = A(fn, [e, 0]);
			      if (p[2]) {
				  return p[2];
			      }
			      return p;
	    })];
}
