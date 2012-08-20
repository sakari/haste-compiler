/* Eval
   Evaluate the given thunk t into head normal form.
   If the "thunk" we get isn't actually a thunk, just return it.
*/
function E(t) {
    if(t instanceof Thunk) {
        if(t.f) {
            t.x = t.f();
            t.f = 0;
        }
        return t.x;
    }
    return t;
}

/* Thunk
   Creates a thunk representing the given closure.
   Since we want automatic memoization of as many expressions as possible, we
   use a JS object as a sort of tagged pointer, where the member x denotes the
   object actually pointed to. If a "pointer" points to a thunk, it has a
   member 't' which is set to true; if it points to a value, be it a function,
   a value of an algebraic type of a primitive value, it has no member 't'.

   When a thunk is evaluated, by reading the member 'x' of the "pointer," the
   closure is evaluated and the getter removed, to be replaced with the value
   returned by the thunk, and the getter finally returns the return value of
   the closure.
*/

function T(f) {
    return new Thunk(f);
}

function Thunk(f) {
    this.f = f;
}

/* Integer literal
   Generates an Integer literal from a Number.
   This might be dependent on using integer-simple for Integers.
*/
function I(n) {
    if(n > 0) {
        return [1,[1, n, 2]];
    } else if(n < 0) {
        return [2,[1,n,2]];
    } else {
        return [3]
    }
}

/* Apply
   Applies the function f to the arguments args. If the application is under-
   saturated, a closure is returned, awaiting further arguments. If it is over-
   saturated, the function is fully applied, and the result (assumed to be a
   function) is then applied to the remaining arguments.
*/
function A(f, args) {
    f = f instanceof Thunk ? E(f) : f;
    // Closure does some funny stuff with functions that occasionally
    // results in non-functions getting applied, so we have to deal with
    // it.
    if(!f.apply) {
        return f;
    }

    var arity = f.arity ? f.arity : f.length;
    if(args.length === arity) {
        return f.apply(null, args);
    }
    if(args.length > arity) {
        var first = args.splice(0, arity);
        return A(f.apply(null, first), args);
    } else {
        var g = function() {
            var as = args.concat(Array.prototype.slice.call(arguments));
            return A(f, as);
        };
        g.arity = arity - args.length;
        return g;
    }
}

/* Throw an error.
   We need to be able to use throw as an exception so we wrap it in a function.
*/
function die(err) {
    throw err;
}

function quot(a, b) {
    return (a-a%b)/b;
}

// 32 bit integer multiplication, with correct overflow behavior
// note that |0 or >>>0 needs to be applied to the result, for int and word
// respectively.
function imul(a, b) {
  // ignore high a * high a as the result will always be truncated
  var lows = (a & 0xffff) * (b & 0xffff); // low a * low b
  var aB = (a & 0xffff) * (b & 0xffff0000); // low a * high b
  var bA = (a & 0xffff0000) * (b & 0xffff); // low b * high a
  return lows + aB + bA; // sum will not exceed 52 bits, so it's safe
}

function addC(a, b) {
    var x = a+b;
    return [1, x & 0xffffffff, x > 0x7fffffff];
}

function subC(a, b) {
    var x = a-b;
    return [1, x & 0xffffffff, x < -2147483648];
}

function sinh (arg) {
    return (Math.exp(arg) - Math.exp(-arg)) / 2;
}

function tanh (arg) {
    return (Math.exp(arg) - Math.exp(-arg)) / (Math.exp(arg) + Math.exp(-arg));
}

function cosh (arg) {
    return (Math.exp(arg) + Math.exp(-arg)) / 2;
}

function log2(x) {
    var high = 1024;
    var low = -1024;
    var i = 0;
    var x2;
    for(;;) {
        x2 = Math.pow(2, i);
        if(x2 <= (x >> 1)) {
            low = i;
            i += (high - i) >> 1;
        } else if(x2 > x) {
            high = i;
            i += (low - i) >> 1;
        } else {
            return i;
        }
    }
    return i;
}

function decodeFloat(x) {
    if(isNaN(x)) {
        return [1, -6755399441055744, 972];
    }
    var sig = x > 0 ? 1 : -1;
    if(!isFinite(x)) {
        return [1, sig * 4503599627370496, 972];
    }
    x = Math.abs(x);
    var exp = log2(x)-52;
    var man = x/Math.pow(2, exp);
    return [1, sig*man, exp];
}

function decodeDouble(x) {
    var decoded = decodeFloat(x);
    var sign = decoded[1] < 0 ? -1 : 1;
    var mantissa = decoded[1]*sign;
    var manLow = mantissa % 0x100000000;
    var manHigh = Math.floor(mantissa / 0x100000000);
    return [1, sign, manHigh, manLow, decoded[2]];
}

function newArr(n, x) {
    var arr = [];
    for(; n >= 0; --n) {
        arr.push(x);
    }
    // Use 0 for the never-examined state argument.
    return [1, 0, arr];
}

function err(str) {
    die(toJSStr(str)[1]);
}

/* unpackCString#
   NOTE: update constructor tags if the code generator starts munging them.
*/
function unCStr(str) {
    return unAppCStr(str, [1]);
}

function unAppCStr(str, chrs) {
    var i = arguments[2] ? arguments[2] : 0;
    if(i >= str.length) {
        return E(chrs);
    } else {
        return [2,[1,str.charAt(i)],T(function() {
            return unAppCStr(str,chrs,i+1);
        })];
    }
}

function fromJSStr(str) {
    return unCStr(E(str)[1]);
}

function toJSStr(str) {
    str = E(str);
    var s = '';
    while(str[0] == 2) {
        var cs = readHSUnicodeChar(str);
        s += cs[0];
        str = cs[1];
    }
    return [1,s];
}

function readHSUnicodeChar(str) {
    var c = E(str[1])[1];
    // If we get slashes, read all numbers we encounter.
    if(c == '\\') {
        var num = '';
        str = E(str[2]);
        if(str == 1) {
            return ['\\', str];
        }
        c = E(str[1])[1];
        while(c >= '0' && c <= '9') {
            num += c;
            str = E(str[2]);
            c = E(str[1])[1];
        }
        if(num.length == 0) {
            return ['\\', str];
        }
        c = String.fromCharCode(Number(num));
        return [c, str];
    } else {
        return [c, E(str[2])];
    }
}

// newMutVar
function nMV(val, st) {
    return [1,st,{x: val}];
}

// readMutVar
function rMV(mv, st) {
    return [1,st,mv.x];
}

// writeMutVar
function wMV(mv, val, st) {
    mv.x = val;
    return [1,st];
}

function localeEncoding(theWorld) {
    return [1,theWorld,'UTF-8'];
}

// every newSomethingSomethingByteArray
function newBA(size, theWorld) {
    var s = '';
    while(size >= 0) {
        s += '';
        --size;
    }
    return [1,theWorld,s];
}

function wOffAddr(addr, off, val, theWorld) {
    addr[off] = val;
    return theWorld;
}

function isDoubleNaN(d,_) {
    return [1,0,isNaN(d)];
}
var isFloatNaN = isDoubleNaN;

function isDoubleInfinite(d,_) {
    return [1,0,d === Infinity];
}
var isFloatInfinite = isDoubleInfinite;

function isDoubleNegativeZero(x,_) {
    return [1,0,x===0 && (1/x)===-Infinity];
}
var isFloatNegativeZero = isDoubleNegativeZero;

function strEq(a, b, _) {
    return [1, 0, a == b];
}

function strOrd(a, b, _) {
    var ord;
    if(a < b) {
        ord = [1];
    } else if(a == b) {
        ord = [2];
    } else {
        ord = [3];
    }
    return [1, 0, [1, ord]];
}

function jsCatch(act, handler, _) {
    try {
        return [1,0,A(act,[0])[2]];
    } catch(e) {
        return [1,0,A(handler,[e,0])[2]];
    }
}

function hs_eqWord64(a, b, _) {
    return [1,0,a==b];
}

var realWorld = 0;
var coercionToken = undefined;

function jsAlert(val,_) {
    if(typeof alert != 'undefined') {
        alert(val);
    } else {
        print(val);
    }
    return [1,0];
}

function jsLog(val,_) {
    console.log(val);
    return [1,0];
}

function jsPrompt(str,_) {
    var val;
    if(typeof prompt != 'undefined') {
        val = prompt(str);
    } else {
        print(str);
        val = readline();
    }
    return [1,0,val == undefined ? '' : val.toString()];
}

function jsEval(str,_) {
    var x = eval(str);
    return [1,0,x == undefined ? '' : x.toString()];
}

function isNull(obj,_) {
    return [1,0,[obj === null]];
}

function jsRead(str,_) {
    return [1,0,Number(str)];
}

function jsShowI(val, _) {return [1,0,val.toString()];}
function jsShow(val, _) {
    var ret = val.toString();
    return [1,0,val == Math.round(val) ? ret + '.0' : ret];
}

function jsSetCB(elem, evt, cb, _) {
    // Count return press in single line text box as a change event.
    if(evt == 'change' && elem.type.toLowerCase() == 'text') {
        setCB(elem, 'keyup', args, function(k) {
            if(k == '\n') {
                A(cb,[[1,k.keyCode], 0]);
            }
        });
    }

    var fun;
    switch(evt) {
    case 'click':
    case 'dblclick':
    case 'mouseup':
    case 'mousedown':
        fun = function(x) {A(cb,[[1,x.button], 0]);};
        break;
    case 'keypress':
    case 'keyup':
    case 'keydown':
        fun = function(x) {A(cb,[[1,x.keyCode], 0]);};
        break;        
    default:
        fun = function() {A(cb,[0]);};
        break;
    }
    return setCB(elem, evt, fun);
}

function setCB(elem, evt, cb) {
    if(elem.addEventListener) {
        elem.addEventListener(evt, cb, false);
        return [1,0,true];
    } else if(elem.attachEvent) {
        elem.attachEvent('on'+evt, cb);
        return [1,0,true];
    }
    return [1,0,false];
}

function jsSetTimeout(msecs, cb, _) {
    window.setTimeout(function() {A(cb,[0]);}, msecs);
    return [1,0];
}

// Round a Float/Double.
function rintDouble(d, _) {
    return [1,0,Math.round(d)];
}
var rintFloat = rintDouble;

// Degenerate versions of u_iswspace, u_iswalnum and u_iswalpha.
function u_iswspace(c, _) {
    return [1,0, c==9 || c==10 || c==13 || c==32];
}

function u_iswalnum(c, _) {
    return [1,0, (c >= 48 && c <= 57) || u_iswalpha(c)[0]];
}

// [a-zA-ZåäöÅÄÖ]
function u_iswalpha(c, _) {
    return [1,0, (c >= 65 && c <= 90) || (c >= 97 && c <= 122) ||
                  c == 229 || c == 228 || c == 246 ||
                  c == 197 || c == 196 || c == 214];
}

function jsGet(elem, prop, _) {
    return [1,0,elem[prop].toString()];
}

function jsSet(elem, prop, val, _) {
    elem[prop] = val;
    return [1,0];
}

function jsGetStyle(elem, prop, _) {
    return [1,0,elem.style[prop].toString()];
}

function jsSetStyle(elem, prop, val, _) {
    elem.style[prop] = val;
    return [1,0];
}

function jsKillChild(child, parent, _) {
    parent.removeChild(child);
    return [1,0];
}

function jsClearChildren(elem, _) {
    while(elem.hasChildNodes()){
        elem.removeChild(elem.lastChild);
    }
    return [1,0];
}

function jsFind(elem, _) {
    var e = document.getElementById(elem)
    if(e) {
        return [1,0,[2,[1,e]]];
    }
    return [1,0,[1]];
}

function jsCreateElem(tag, _) {
    return [1,0,document.createElement(tag)];
}

function jsGetChildBefore(elem, _) {
    elem = elem.previousSibling;
    while(elem) {
        if(typeof elem.tagName != 'undefined') {
            return [1,0,[2,[1,elem]]];
        }
        elem = elem.previousSibling;
    }
    return [1,0,[1]];
}

function jsGetLastChild(elem, _) {
    var len = elem.childNodes.length;
    for(var i = len-1; i >= 0; --i) {
        if(typeof elem.childNodes[i].tagName != 'undefined') {
            return [1,0,[2,[1,elem.childNodes[i]]]];
        }
    }
    return [1,0,[1]];
}

function jsGetChildren(elem, _) {
    var children = [1];
    var len = elem.childNodes.length;
    for(var i = len-1; i >= 0; --i) {
        if(typeof elem.childNodes[i].tagName != 'undefined') {
            children = [2, [1,elem.childNodes[i]], children];
        }
    }
    return [1,0,children];
}

function jsSetChildren(elem, children, _) {
    children = E(children);
    jsClearChildren(elem, 0);
    while(children[0] === 2) {
        elem.appendChild(E(E(children[1])[1]));
        children = E(children[2]);
    }
    return [1,0];
}

function jsAppendChild(child, container, _) {
    container.appendChild(child);
    return [1,0];
}

function jsAddChildBefore(child, container, after, _) {
    container.insertBefore(child, after);
    return [1,0];
}

function jsRand(_) {
    return [1,0,Math.random()];
}

// Concatenate a Haskell list of JS strings
function jsCat(strs, sep, _) {
    var arr = [];
    strs = E(strs);
    while(strs[0] != 1) {
        strs = E(strs);
        arr.push(E(strs[1])[1]);
        strs = E(strs[2]);
    }
    return [1,0,arr.join(sep)];
}

// Escape all double quotes in a string
function jsUnquote(str, _) {
    return [1,0,str.replace(/"/, '\\"')];
}

// Parse a JSON message into a Haste.JSON.JSON value.
// As this pokes around inside Haskell values, it'll need to be updated if:
// * Haste.JSON.JSON changes;
// * E() starts to choke on non-thunks;
// * data constructor code generation changes; or
// * Just and Nothing change tags.
function jsParseJSON(str, _) {
    try {
        var js = JSON.parse(str);
        var hs = toHS(js);
    } catch(_) {
        return [1,0,[1]];
    }
    return [1,0,[2,hs]];
}

function toHS(obj) {
    switch(typeof obj) {
    case 'number':
        return [1, [1, jsRead(obj)[2]]];
    case 'string':
        return [2, [1, obj]];
        break;
    case 'boolean':
        return [3, obj]; // Booleans are special wrt constructor tags!
        break;
    case 'object':
        if(obj instanceof Array) {
            return [4, arr2lst(obj, 0)];
        } else {
            // Object type but not array - it's a dictionary.
            // The RFC doesn't say anything about the ordering of keys, but
            // considering that lots of people rely on keys being "in order" as
            // defined by "the same way someone put them in at the other end,"
            // it's probably a good idea to put some cycles into meeting their
            // misguided expectations.
            var ks = [];
            for(var k in obj) {
                ks.unshift(k);
            }
            var xs = [1];
            for(var i in ks) {
                xs = [2, [1, [1,ks[i]], toHS(obj[ks[i]])], xs];
            }
            return [5, xs];
        }
    }
}

function arr2lst(arr, elem) {
    if(elem >= arr.length) {
        return [1];
    }
    return [2, toHS(arr[elem]), T(function() {return arr2lst(arr,elem+1);})]
}

function ajaxReq(method, url, async, postdata, cb, _) {
    var xhr = new XMLHttpRequest();
    xhr.open(method, url, async);
    xhr.setRequestHeader('Cache-control', 'no-cache');
    xhr.onreadystatechange = function() {
        if(xhr.readyState == 4) {
            if(xhr.status == 200) {
                A(cb,[[1,xhr.responseText],0]);
            } else {
                A(cb,[[1,""],0]); // Nothing
            }
        }
    }
    xhr.send(postdata);
    return [1,0];
}

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

var _0 = function(_1,_2,_3){var _4 = A(_1,[_3]);var _5 = _4[1];var _6 = A(_2,[_5]);return _6;};var _7 = function(_8,_9,_a){return _0(_8,_9,_a);};var _b = function(_c,_d,_e){var _f = A(_c,[_e]);var _g = _f[1];var _h = _f[2];var _i = A(_d,[_h,_g]);return _i;};var _j = function(_k,_l){return [1,_l,_k];};var _m = T(function(){return unCStr("Maybe.fromJust: Nothing");});var _n = T(function(){return err(_m);});var _o = function(_p,_q,_r){var _s = T(function(){var _t = A(_p,[_r]);var _u = _t[1];var _v = _t[2];var _w = T(function(){var _x = E(_s);if(_x[0]==1){var _y = E(_n);}else{var _z = _x[1];var _y = E(_z);}return _y;});var _A = A(_q,[_w]);var _B = _A[1];var _C = _A[2];var _D = hs_eqWord64(_u,_B,realWorld);var _E = _D[2];var _F = E(_E);if(_F){var _G = hs_eqWord64(_v,_C,realWorld);var _H = _G[2];var _I = E(_H);var _J = _I?[2,_r]:[1];var _K = _J;}else{var _K = [1];}return _K;});return E(_s);};var _L = function(_M){var _N = E(_M);var _O = _N[1];var _P = E(_O);return _P;};var _Q = T(function(){return unCStr("base");});var _R = T(function(){return unCStr("GHC.IO.Exception");});var _S = T(function(){return unCStr("IOException");});var _T = [1,7238999624334008320,1.0769272474234763e19,_Q,_R,_S];var _U = [1];var _V = [1,7238999624334008320,1.0769272474234763e19,_T,_U];var _W = function(_X){return E(_V);};var _Y = function(_Z){var _10 = E(_Z);var _11 = _10[1];var _12 = _10[2];var _13 = _L(_11);var _14 = _o(_13,_W,_12);return _14;};var _15 = function(_16,_17){var _18 = E(_16);if(_18[0]==1){var _19 = E(_17);}else{var _1a = _18[1];var _1b = _18[2];var _1c = T(function(){return _15(_1b,_17);});var _19 = [2,_1a,_1c];}return _19;};var _1d = T(function(){return unCStr(": ");});var _1e = T(function(){return unCStr("already exists");});var _1f = T(function(){return unCStr("does not exist");});var _1g = T(function(){return unCStr("protocol error");});var _1h = T(function(){return unCStr("failed");});var _1i = T(function(){return unCStr("invalid argument");});var _1j = T(function(){return unCStr("inappropriate type");});var _1k = T(function(){return unCStr("hardware fault");});var _1l = T(function(){return unCStr("unsupported operation");});var _1m = T(function(){return unCStr("timeout");});var _1n = T(function(){return unCStr("resource vanished");});var _1o = T(function(){return unCStr("interrupted");});var _1p = T(function(){return unCStr("resource busy");});var _1q = T(function(){return unCStr("resource exhausted");});var _1r = T(function(){return unCStr("end of file");});var _1s = T(function(){return unCStr("illegal operation");});var _1t = T(function(){return unCStr("permission denied");});var _1u = T(function(){return unCStr("user error");});var _1v = T(function(){return unCStr("unsatisified constraints");});var _1w = T(function(){return unCStr("system error");});var _1x = function(_1y,_1z){var _1A = E(_1y);switch(_1A[0]){case 1:var _1B = _15(_1e,_1z);break;case 2:var _1B = _15(_1f,_1z);break;case 3:var _1B = _15(_1p,_1z);break;case 4:var _1B = _15(_1q,_1z);break;case 5:var _1B = _15(_1r,_1z);break;case 6:var _1B = _15(_1s,_1z);break;case 7:var _1B = _15(_1t,_1z);break;case 8:var _1B = _15(_1u,_1z);break;case 9:var _1B = _15(_1v,_1z);break;case 10:var _1B = _15(_1w,_1z);break;case 11:var _1B = _15(_1g,_1z);break;case 12:var _1B = _15(_1h,_1z);break;case 13:var _1B = _15(_1i,_1z);break;case 14:var _1B = _15(_1j,_1z);break;case 15:var _1B = _15(_1k,_1z);break;case 16:var _1B = _15(_1l,_1z);break;case 17:var _1B = _15(_1m,_1z);break;case 18:var _1B = _15(_1n,_1z);break;case 19:var _1B = _15(_1o,_1z);break;}return _1B;};var _1C = T(function(){return unCStr(" (");});var _1D = [1,')'];var _1E = [1,'}'];var _1F = T(function(){return unCStr("{handle: ");});var _1G = function(_1H,_1I,_1J,_1K,_1L,_1M){var _1N = T(function(){var _1O = T(function(){var _1P = T(function(){var _1Q = E(_1K);if(_1Q[0]==1){var _1R = E(_1M);}else{var _1S = T(function(){var _1T = [2,_1D,_1M];return _15(_1Q,_1T);});var _1R = _15(_1C,_1S);}return _1R;});return _1x(_1I,_1P);});var _1U = E(_1J);if(_1U[0]==1){var _1V = E(_1O);}else{var _1W = T(function(){return _15(_1d,_1O);});var _1V = _15(_1U,_1W);}return _1V;});var _1X = E(_1L);if(_1X[0]==1){var _1Y = E(_1H);if(_1Y[0]==1){var _1Z = E(_1N);}else{var _20 = _1Y[1];var _21 = E(_20);if(_21[0]==1){var _22 = _21[1];var _23 = T(function(){var _24 = T(function(){return _15(_1d,_1N);});var _25 = [2,_1E,_24];return _15(_22,_25);});var _26 = _15(_1F,_23);}else{var _27 = _21[1];var _28 = T(function(){var _29 = T(function(){return _15(_1d,_1N);});var _2a = [2,_1E,_29];return _15(_27,_2a);});var _26 = _15(_1F,_28);}var _1Z = _26;}var _2b = _1Z;}else{var _2c = _1X[1];var _2d = T(function(){return _15(_1d,_1N);});var _2b = _15(_2c,_2d);}return _2b;};var _2e = function(_2f){var _2g = E(_2f);var _2h = _2g[1];var _2i = _2g[2];var _2j = _2g[3];var _2k = _2g[4];var _2l = _2g[6];var _2m = _1G(_2h,_2i,_2j,_2k,_2l,_U);return _2m;};var _2n = [1,','];var _2o = [1,']'];var _2p = [1,'['];var _2q = function(_2r,_2s){var _2t = E(_2r);if(_2t[0]==1){var _2u = unAppCStr("[]",_2s);}else{var _2v = _2t[1];var _2w = _2t[2];var _2x = T(function(){var _2y = E(_2v);var _2z = _2y[1];var _2A = _2y[2];var _2B = _2y[3];var _2C = _2y[4];var _2D = _2y[6];var _2E = T(function(){var _2F = [2,_2o,_2s];var _2G = function(_2H){var _2I = E(_2H);if(_2I[0]==1){var _2J = E(_2F);}else{var _2K = _2I[1];var _2L = _2I[2];var _2M = T(function(){var _2N = E(_2K);var _2O = _2N[1];var _2P = _2N[2];var _2Q = _2N[3];var _2R = _2N[4];var _2S = _2N[6];var _2T = T(function(){return _2G(_2L);});var _2U = _1G(_2O,_2P,_2Q,_2R,_2S,_2T);return _2U;});var _2J = [2,_2n,_2M];}return _2J;};return _2G(_2w);});var _2V = _1G(_2z,_2A,_2B,_2C,_2D,_2E);return _2V;});var _2u = [2,_2p,_2x];}return _2u;};var _2W = function(_2X,_2Y,_2Z){var _30 = E(_2Y);var _31 = _30[1];var _32 = _30[2];var _33 = _30[3];var _34 = _30[4];var _35 = _30[6];var _36 = _1G(_31,_32,_33,_34,_35,_2Z);return _36;};var _37 = [1,_2W,_2e,_2q];var _38 = T(function(){return [1,_W,_37,_39,_Y];});var _39 = function(_3a){return [1,_38,_3a];};var _3b = [1];var _3c = [8];var _3d = function(_3e){return [1,_3b,_3c,_U,_3e,_3b,_3b];};var _3f = function(_3g,_3h){var _3i = T(function(){var _3j = T(function(){return _3d(_3g);});return _39(_3j);});return die(_3i,_3h);};var _3k = function(_3l,_3m){return _3f(_3l,_3m);};var _3n = [1,_b,_7,_j,_3k];var _3o = function(_3p){var _3q = E(_3p);var _3r = _3q[1];var _3s = E(_3r);return _3s;};var _3t = function(_3u,_3v,_3w){var _3x = A(_3v,[_3w]);var _3y = _3x[1];var _3z = [1,_3y,_3u];return _3z;};var _3A = function(_3B,_3C,_3D){var _3E = A(_3C,[_3D]);var _3F = _3E[1];var _3G = _3E[2];var _3H = T(function(){return A(_3B,[_3G]);});var _3I = [1,_3F,_3H];return _3I;};var _3J = [1,_3A,_3t];var _3K = function(_3L){var _3M = E(_3L);var _3N = _3M[1];var _3O = E(_3N);return _3O;};var _3P = function(_3Q){var _3R = _testArray(_3Q);var _3S = _3R[1];var _3T = _3R[2];var _3U = [1,_3T];var _3V = [1,_3S,_3U];return _3V;};var _3W = function(_3X){return _3P(_3X);};var _3Y = function(_3Z){return E(_3Z);};var _40 = T(function(){return A(_3K,[_3J,_3Y,_3W]);});var _41 = function(_42,_43,_44){var _45 = T(function(){return A(_43,[_44]);});return A(_42,[_45]);};var _46 = function(_47){var _48 = E(_47);var _49 = _48[2];var _4a = E(_49);return _4a;};var _4b = function(_4c){var _4d = E(_4c);var _4e = _4d[3];var _4f = E(_4e);return _4f;};var _4g = function(_4h){var _4i = E(_4h);var _4j = _4i[1];var _4k = _4j>=0;if(_4k){var _4l = E(_4i);}else{var _4m = -_4j;var _4n = [1,_4m];var _4l = _4n;}return _4l;};var _4o = function(_4p){var _4q = E(_4p);if(_4q[0]==1){var _4r = _4q[1];var _4s = _4q[2];var _4t = _4o(_4s);var _4u = (_4r&65535)>>>0;var _4v = _4u&4294967295;var _4w = _4v;var _4x = Math.pow(2,16);var _4y = _4r>>>16;var _4z = _4y&4294967295;var _4A = _4z;var _4B = _4A*_4x;var _4C = Math.pow(2,32);var _4D = _4t*_4C;var _4E = _4D+_4B;var _4F = _4E+_4w;var _4G = _4F;}else{var _4G = 0;}return _4G;};var _4H = function(_4I){var _4J = E(_4I);switch(_4J[0]){case 1:var _4K = _4J[1];var _4L = _4o(_4K);break;case 2:var _4M = _4J[1];var _4N = _4o(_4M);var _4O = -_4N;var _4L = _4O;break;case 3:var _4L = 0;break;}return _4L;};var _4P = function(_4Q){var _4R = _4H(_4Q);var _4S = [1,_4R];return _4S;};var _4T = [1,0];var _4U = [1,1];var _4V = [1,(-1)];var _4W = function(_4X){var _4Y = E(_4X);var _4Z = _4Y[1];var _50 = _4Z==0;if(_50){var _51 = E(_4T);}else{var _52 = _4Z>0;var _51 = _52?E(_4U):E(_4V);}return _51;};var _53 = function(_54,_55){var _56 = E(_54);var _57 = _56[1];var _58 = E(_55);var _59 = _58[1];var _5a = _57-_59;var _5b = [1,_5a];return _5b;};var _5c = function(_5d){var _5e = E(_5d);var _5f = _5e[1];var _5g = -_5f;var _5h = [1,_5g];return _5h;};var _5i = function(_5j,_5k){var _5l = E(_5j);var _5m = _5l[1];var _5n = E(_5k);var _5o = _5n[1];var _5p = _5m+_5o;var _5q = [1,_5p];return _5q;};var _5r = function(_5s,_5t){var _5u = E(_5s);var _5v = _5u[1];var _5w = E(_5t);var _5x = _5w[1];var _5y = _5v*_5x;var _5z = [1,_5y];return _5z;};var _5A = [1,_5i,_5r,_53,_5c,_4g,_4W,_4P];var _5B = function(_5C){var _5D = E(_5C);var _5E = _5D[1];var _5F = E(_5E);return _5F;};var _5G = function(_5H){return [1,_5H];};var _5I = function(_5J,_5K){var _5L = T(function(){var _5M = A(_5G,[_5J]);var _5N = _5M[1];var _5O = E(_5K);var _5P = _5O[1];var _5Q = function(_5R){var _5S = _arrayMap(_5N,_5P,_5R);var _5T = _5S[1];var _5U = _5S[2];var _5V = [1,_5U];var _5W = [1,_5T,_5V];return _5W;};var _5X = E(_5Q);return _5X;});var _5Y = function(_5Z){return E(_5Z);};return A(_3K,[_3J,_5Y,_5L]);};var _60 = [1,'-'];var _61 = function(_62,_63){var _64 = E(_63);if(_64[0]==1){var _65 = [1];}else{var _66 = _64[1];var _67 = _64[2];var _68 = T(function(){return _61(_62,_67);});var _69 = T(function(){return A(_62,[_66]);});var _65 = [2,_69,_68];}return _65;};var _6a = T(function(){return unCStr("base");});var _6b = T(function(){return unCStr("Control.Exception.Base");});var _6c = T(function(){return unCStr("PatternMatchFail");});var _6d = [1,1.605959309876327e19,1.3945565038419476e19,_6a,_6b,_6c];var _6e = [1,1.605959309876327e19,1.3945565038419476e19,_6d,_U];var _6f = function(_6g){return E(_6e);};var _6h = function(_6i){var _6j = E(_6i);var _6k = _6j[1];var _6l = _6j[2];var _6m = _L(_6k);var _6n = _o(_6m,_6f,_6l);return _6n;};var _6o = function(_6p){var _6q = E(_6p);var _6r = _6q[1];var _6s = E(_6r);return _6s;};var _6t = function(_6u,_6v){var _6w = E(_6u);if(_6w[0]==1){var _6x = unAppCStr("[]",_6v);}else{var _6y = _6w[1];var _6z = _6w[2];var _6A = T(function(){var _6B = E(_6y);var _6C = _6B[1];var _6D = T(function(){var _6E = [2,_2o,_6v];var _6F = function(_6G){var _6H = E(_6G);if(_6H[0]==1){var _6I = E(_6E);}else{var _6J = _6H[1];var _6K = _6H[2];var _6L = T(function(){var _6M = E(_6J);var _6N = _6M[1];var _6O = T(function(){return _6F(_6K);});var _6P = _15(_6N,_6O);return _6P;});var _6I = [2,_2n,_6L];}return _6I;};return _6F(_6z);});var _6Q = _15(_6C,_6D);return _6Q;});var _6x = [2,_2p,_6A];}return _6x;};var _6R = function(_6S,_6T,_6U){var _6V = E(_6T);var _6W = _6V[1];var _6X = _15(_6W,_6U);return _6X;};var _6Y = [1,_6R,_6o,_6t];var _6Z = T(function(){return [1,_6f,_6Y,_70,_6h];});var _70 = function(_71){return [1,_6Z,_71];};var _72 = T(function(){return unCStr("Irrefutable pattern failed for pattern");});var _73 = function(_74,_75){var _76 = T(function(){return A(_75,[_74]);});return die(_76);};var _77 = [1,' '];var _78 = [1,'\n'];var _79 = [2,_78,_U];var _7a = function(_7b){var _7c = E(_7b);var _7d = _7c[1];var _7e = E(_7d);var _7f = _7e=='|'?false:true;return _7f;};var _7g = function(_7h,_7i){var _7j = E(_7i);if(_7j[0]==1){var _7k = [1,_U,_U];}else{var _7l = _7j[1];var _7m = _7j[2];var _7n = A(_7h,[_7l]);if(_7n){var _7o = T(function(){var _7p = _7g(_7h,_7m);var _7q = _7p[1];var _7r = _7p[2];var _7s = [1,_7q,_7r];return _7s;});var _7t = T(function(){var _7u = E(_7o);var _7v = _7u[2];var _7w = E(_7v);return _7w;});var _7x = T(function(){var _7y = E(_7o);var _7z = _7y[1];var _7A = E(_7z);return _7A;});var _7B = [2,_7l,_7x];var _7C = [1,_7B,_7t];}else{var _7C = [1,_U,_7j];}var _7k = _7C;}return _7k;};var _7D = function(_7E,_7F){var _7G = unCStr(_7E);var _7H = _7g(_7a,_7G);var _7I = _7H[1];var _7J = _7H[2];var _7K = function(_7L,_7M){var _7N = T(function(){var _7O = T(function(){var _7P = T(function(){return _15(_7M,_79);});return _15(_7F,_7P);});return unAppCStr(": ",_7O);});return _15(_7L,_7N);};var _7Q = E(_7J);if(_7Q[0]==1){var _7R = _7K(_7I,_U);}else{var _7S = _7Q[1];var _7T = _7Q[2];var _7U = E(_7S);var _7V = _7U[1];var _7W = E(_7V);if(_7W=='|'){var _7X = [2,_77,_7T];var _7Y = _7K(_7I,_7X);}else{var _7Y = _7K(_7I,_U);}var _7R = _7Y;}return _7R;};var _7Z = function(_80){var _81 = T(function(){return _7D(_80,_72);});var _82 = [1,_81];return _73(_82,_70);};var _83 = T(function(){return _7Z("GHC/Float.lhs:631:11-64|d : ds'");});var _84 = [1,0];var _85 = [1,'-'];var _86 = function(_87,_88){while(1){var _89 = _87<10;if(_89){var _8a = 48+_87|0;var _8b = String.fromCharCode(_8a);var _8c = [1,_8b];var _8d = [2,_8c,_88];var _8e = _8d;}else{var _8f = _87%10;var _8g = 48+_8f|0;var _8h = String.fromCharCode(_8g);var _8i = [1,_8h];var _8j = [2,_8i,_88];var _8k = quot(_87,10);_87=_8k;_88=_8j;continue;var _8l = die("Unreachable!");var _8e = _8l;}return _8e;}};var _8m = function(_8n,_8o){var _8p = _8n<0;if(_8p){var _8q = E(_8n);if(_8q==(-2147483648)){var _8r = T(function(){var _8s = T(function(){return _86(8,_8o);});return _86(214748364,_8s);});var _8t = [2,_85,_8r];}else{var _8u = T(function(){var _8v = -_8q;var _8w = _86(_8v,_8o);return _8w;});var _8t = [2,_85,_8u];}var _8x = _8t;}else{var _8x = _86(_8n,_8o);}return _8x;};var _8y = function(_8z){var _8A = T(function(){return _8m(_8z,_U);});var _8B = unAppCStr("Char.intToDigit: not a digit ",_8A);var _8C = err(_8B);return _8C;};var _8D = function(_8E){var _8F = T(function(){var _8G = _8E>=10;if(_8G){var _8H = _8E<=15;if(_8H){var _8I = 87+_8E|0;var _8J = String.fromCharCode(_8I);var _8K = [1,_8J];var _8L = _8K;}else{var _8L = _8y(_8E);}var _8M = _8L;}else{var _8M = _8y(_8E);}return _8M;});var _8N = _8E>=0;if(_8N){var _8O = _8E<=9;if(_8O){var _8P = 48+_8E|0;var _8Q = String.fromCharCode(_8P);var _8R = _8Q;}else{var _8S = E(_8F);var _8T = _8S[1];var _8U = E(_8T);var _8R = _8U;}var _8V = _8R;}else{var _8W = E(_8F);var _8X = _8W[1];var _8Y = E(_8X);var _8V = _8Y;}return _8V;};var _8Z = function(_90){var _91 = E(_90);var _92 = _91[1];var _93 = _8D(_92);var _94 = [1,_93];return _94;};var _95 = function(_96,_97){var _98 = E(_96);var _99 = _98[1];var _9a = _99>0;if(_9a){var _9b = _61(_8Z,_97);if(_9b[0]==1){var _9c = E(_83);}else{var _9d = _9b[1];var _9e = _9b[2];var _9c = [1,_9d,_9e];}var _9f = _9c;}else{var _9g = [2,_84,_97];var _9h = _61(_8Z,_9g);if(_9h[0]==1){var _9i = E(_83);}else{var _9j = _9h[1];var _9k = _9h[2];var _9i = [1,_9j,_9k];}var _9f = _9i;}return _9f;};var _9l = T(function(){return unCStr("base");});var _9m = T(function(){return unCStr("GHC.Exception");});var _9n = T(function(){return unCStr("ArithException");});var _9o = [1,3089387606753565184,7918018744409604096,_9l,_9m,_9n];var _9p = [1,3089387606753565184,7918018744409604096,_9o,_U];var _9q = function(_9r){return E(_9p);};var _9s = function(_9t){var _9u = E(_9t);var _9v = _9u[1];var _9w = _9u[2];var _9x = _L(_9v);var _9y = _o(_9x,_9q,_9w);return _9y;};var _9z = T(function(){return unCStr("denormal");});var _9A = T(function(){return unCStr("divide by zero");});var _9B = T(function(){return unCStr("loss of precision");});var _9C = T(function(){return unCStr("arithmetic underflow");});var _9D = T(function(){return unCStr("arithmetic overflow");});var _9E = function(_9F){var _9G = E(_9F);switch(_9G[0]){case 1:var _9H = E(_9D);break;case 2:var _9H = E(_9C);break;case 3:var _9H = E(_9B);break;case 4:var _9H = E(_9A);break;case 5:var _9H = E(_9z);break;}return _9H;};var _9I = function(_9J,_9K){var _9L = E(_9J);if(_9L[0]==1){var _9M = unAppCStr("[]",_9K);}else{var _9N = _9L[1];var _9O = _9L[2];var _9P = T(function(){var _9Q = T(function(){var _9R = [2,_2o,_9K];var _9S = function(_9T){var _9U = E(_9T);if(_9U[0]==1){var _9V = E(_9R);}else{var _9W = _9U[1];var _9X = _9U[2];var _9Y = T(function(){var _9Z = E(_9W);switch(_9Z[0]){case 1:var _a0 = T(function(){return _9S(_9X);});var _a1 = _15(_9D,_a0);break;case 2:var _a2 = T(function(){return _9S(_9X);});var _a1 = _15(_9C,_a2);break;case 3:var _a3 = T(function(){return _9S(_9X);});var _a1 = _15(_9B,_a3);break;case 4:var _a4 = T(function(){return _9S(_9X);});var _a1 = _15(_9A,_a4);break;case 5:var _a5 = T(function(){return _9S(_9X);});var _a1 = _15(_9z,_a5);break;}return _a1;});var _9V = [2,_2n,_9Y];}return _9V;};return _9S(_9O);});var _a6 = E(_9N);switch(_a6[0]){case 1:var _a7 = _15(_9D,_9Q);break;case 2:var _a7 = _15(_9C,_9Q);break;case 3:var _a7 = _15(_9B,_9Q);break;case 4:var _a7 = _15(_9A,_9Q);break;case 5:var _a7 = _15(_9z,_9Q);break;}return _a7;});var _9M = [2,_2p,_9P];}return _9M;};var _a8 = function(_a9){return _15(_9D,_a9);};var _aa = function(_a9){return _15(_9z,_a9);};var _ab = function(_a9){return _15(_9A,_a9);};var _ac = function(_a9){return _15(_9B,_a9);};var _ad = function(_a9){return _15(_9C,_a9);};var _ae = function(_af,_ag){var _ah = E(_ag);switch(_ah[0]){case 1:var _ai = E(_a8);break;case 2:var _ai = E(_ad);break;case 3:var _ai = E(_ac);break;case 4:var _ai = E(_ab);break;case 5:var _ai = E(_aa);break;}return _ai;};var _aj = [1,_ae,_9E,_9I];var _ak = T(function(){return [1,_9q,_aj,_al,_9s];});var _al = function(_a9){return [1,_ak,_a9];};var _am = [4];var _an = T(function(){return _73(_am,_al);});var _ao = I(1);var _ap = I(2);var _aq = T(function(){return unCStr("(Array.!): undefined array element");});var _ar = T(function(){return err(_aq);});var _as = [1,0];var _at = T(function(){return unCStr(" out of range ");});var _au = T(function(){return unCStr("}.index: Index ");});var _av = T(function(){return unCStr("Ix{");});var _aw = [1,')'];var _ax = [2,_aw,_U];var _ay = [1,0];var _az = function(_aA,_aB,_aC){var _aD = E(_aC);if(_aD[0]==1){var _aE = E(_aB);}else{var _aF = _aD[1];var _aG = _aD[2];var _aH = T(function(){return _az(_aA,_aF,_aG);});var _aE = A(_aA,[_aB,_aH]);}return _aE;};var _aI = T(function(){return unCStr(": empty list");});var _aJ = T(function(){return unCStr("Prelude.");});var _aK = function(_aL){var _aM = T(function(){return _15(_aL,_aI);});var _aN = _15(_aJ,_aM);var _aO = err(_aN);return _aO;};var _aP = T(function(){return unCStr("foldr1");});var _aQ = T(function(){return _aK(_aP);});var _aR = function(_aS,_aT,_aU){var _aV = T(function(){return A(_aT,[_aU]);});var _aW = [2,_2n,_aV];return A(_aS,[_aW]);};var _aX = [1,'('];var _aY = function(_aZ){var _b0 = T(function(){var _b1 = E(_aZ);if(_b1[0]==1){var _b2 = E(_aQ);}else{var _b3 = _b1[1];var _b4 = _b1[2];var _b5 = E(_b4);if(_b5[0]==1){var _b6 = E(_b3);}else{var _b7 = _b5[1];var _b8 = _b5[2];var _b9 = T(function(){return _az(_aR,_b7,_b8);});var _ba = function(_bb){var _bc = T(function(){return A(_b9,[_bb]);});var _bd = [2,_2n,_bc];return A(_b3,[_bd]);};var _b6 = E(_ba);}var _b2 = _b6;}return _b2;});var _be = function(_bf){var _bg = T(function(){var _bh = [2,_aw,_bf];return A(_b0,[_bh]);});return [2,_aX,_bg];};return E(_be);};var _bi = function(_bj){var _bk = E(_bj);var _bl = _bk[1];var _bm = E(_bl);return _bm;};var _bn = function(_bo,_bp,_bq,_br,_bs){var _bt = T(function(){return A(_bi,[_bp,_ay,_br]);});var _bu = [2,_bt,_U];var _bv = T(function(){return A(_bi,[_bo,_ay,_bq]);});var _bw = [2,_bv,_bu];return A(_aY,[_bw,_bs]);};var _bx = function(_by,_bz,_bA,_bB,_bC){var _bD = T(function(){var _bE = T(function(){var _bF = T(function(){var _bG = T(function(){var _bH = T(function(){return _bn(_bC,_bC,_bA,_bB,_ax);});var _bI = [2,_aX,_bH];return _15(_at,_bI);});var _bJ = [2,_aw,_bG];return A(_bi,[_bC,_as,_bz,_bJ]);});var _bK = [2,_aX,_bF];return _15(_au,_bK);});return _15(_by,_bE);});var _bL = _15(_av,_bD);var _bM = err(_bL);return _bM;};var _bN = function(_bO,_bP,_bQ,_bR){var _bS = E(_bQ);var _bT = _bS[1];var _bU = _bS[2];var _bV = _bx(_bO,_bP,_bT,_bU,_bR);return _bV;};var _bW = function(_bX,_bY,_bZ,_c0){return _bN(_c0,_bZ,_bY,_bX);};var _c1 = [1,1100];var _c2 = [1,_84,_c1];var _c3 = T(function(){return unCStr("Int");});var _c4 = function(_c5,_c6,_c7){var _c8 = _c6<0;if(_c8){var _c9 = _c5>6;if(_c9){var _ca = T(function(){var _cb = [2,_aw,_c7];return _8m(_c6,_cb);});var _cc = [2,_aX,_ca];}else{var _cc = _8m(_c6,_c7);}var _cd = _cc;}else{var _cd = _8m(_c6,_c7);}return _cd;};var _ce = function(_cf){var _cg = E(_cf);var _ch = _cg[1];var _ci = _c4(0,_ch,_U);return _ci;};var _cj = function(_ck,_cl){var _cm = E(_ck);if(_cm[0]==1){var _cn = unAppCStr("[]",_cl);}else{var _co = _cm[1];var _cp = _cm[2];var _cq = T(function(){var _cr = E(_co);var _cs = _cr[1];var _ct = T(function(){var _cu = [2,_2o,_cl];var _cv = function(_cw){var _cx = E(_cw);if(_cx[0]==1){var _cy = E(_cu);}else{var _cz = _cx[1];var _cA = _cx[2];var _cB = T(function(){var _cC = E(_cz);var _cD = _cC[1];var _cE = T(function(){return _cv(_cA);});var _cF = _c4(0,_cD,_cE);return _cF;});var _cy = [2,_2n,_cB];}return _cy;};return _cv(_cp);});var _cG = _c4(0,_cs,_ct);return _cG;});var _cn = [2,_2p,_cq];}return _cn;};var _cH = function(_cI,_cJ,_cK){var _cL = E(_cI);var _cM = _cL[1];var _cN = E(_cJ);var _cO = _cN[1];var _cP = _c4(_cM,_cO,_cK);return _cP;};var _cQ = [1,_cH,_ce,_cj];var _cR = function(_cS){var _cT = [1,_cS];return _bW(_cQ,_c2,_cT,_c3);};var _cU = I(1);var _cV = [2];var _cW = [1,E(47),E(_cV)];var _cX = [1,E(1),E(_cV)];var _cY = function(_cZ){var _d0 = E(_cZ);if(_d0[0]==1){var _d1 = _d0[1];var _d2 = _d0[2];var _d3 = _d1==4294967295;if(_d3){var _d4 = _cY(_d2);var _d5 = [1,E(0),E(_d4)];var _d6 = _d5;}else{var _d7 = _d1+1>>>0;var _d8 = [1,E(_d7),E(_d2)];var _d6 = _d8;}var _d9 = _d6;}else{var _d9 = E(_cX);}return _d9;};var _da = T(function(){return _cY(_cV);});var _db = function(_dc,_dd,_de,_df,_dg){var _dh = _dd<_df;if(_dh){var _di = _db(_dc,_df,_dg,_dd,_de);}else{var _dj = _df>=2147483648;if(_dj){var _dk = _dl(1,_de,_dg);var _dm = _df-2147483648>>>0;var _dn = _dd-2147483648>>>0;var _do = _dn+_dm>>>0;var _dp = _do+_dc>>>0;var _dq = [1,E(_dp),E(_dk)];var _dr = _dq;}else{var _ds = _dd>=2147483648;if(_ds){var _dt = _dd-2147483648>>>0;var _du = _dt+_df>>>0;var _dv = _du+_dc>>>0;var _dw = _dv<2147483648;if(_dw){var _dx = _dl(0,_de,_dg);var _dy = _dv+2147483648>>>0;var _dz = [1,E(_dy),E(_dx)];var _dA = _dz;}else{var _dB = _dl(1,_de,_dg);var _dC = _dv-2147483648>>>0;var _dD = [1,E(_dC),E(_dB)];var _dA = _dD;}var _dE = _dA;}else{var _dF = _dl(0,_de,_dg);var _dG = _dd+_df>>>0;var _dH = _dG+_dc>>>0;var _dI = [1,E(_dH),E(_dF)];var _dE = _dI;}var _dr = _dE;}var _di = _dr;}return _di;};var _dl = function(_dJ,_dK,_dL){var _dM = E(_dK);if(_dM[0]==1){var _dN = _dM[1];var _dO = _dM[2];var _dP = E(_dL);if(_dP[0]==1){var _dQ = _dP[1];var _dR = _dP[2];var _dS = _dN<_dQ;if(_dS){var _dT = _db(_dJ,_dQ,_dR,_dN,_dO);}else{var _dU = _dQ>=2147483648;if(_dU){var _dV = _dl(1,_dO,_dR);var _dW = _dQ-2147483648>>>0;var _dX = _dN-2147483648>>>0;var _dY = _dX+_dW>>>0;var _dZ = _dY+_dJ>>>0;var _e0 = [1,E(_dZ),E(_dV)];var _e1 = _e0;}else{var _e2 = _dN>=2147483648;if(_e2){var _e3 = _dN-2147483648>>>0;var _e4 = _e3+_dQ>>>0;var _e5 = _e4+_dJ>>>0;var _e6 = _e5<2147483648;if(_e6){var _e7 = _dl(0,_dO,_dR);var _e8 = _e5+2147483648>>>0;var _e9 = [1,E(_e8),E(_e7)];var _ea = _e9;}else{var _eb = _dl(1,_dO,_dR);var _ec = _e5-2147483648>>>0;var _ed = [1,E(_ec),E(_eb)];var _ea = _ed;}var _ee = _ea;}else{var _ef = _dl(0,_dO,_dR);var _eg = _dN+_dQ>>>0;var _eh = _eg+_dJ>>>0;var _ei = [1,E(_eh),E(_ef)];var _ee = _ei;}var _e1 = _ee;}var _dT = _e1;}var _ej = _dT;}else{var _ek = _dJ==0;var _ej = _ek?E(_dM):_cY(_dM);}var _el = _ej;}else{var _em = E(_dL);if(_em[0]==1){var _en = _dJ==0;var _eo = _en?E(_em):_cY(_em);}else{var _ep = _dJ==0;var _eo = _ep?[2]:E(_da);}var _el = _eo;}return _el;};var _eq = function(_er,_es){var _et = _es>>>16;var _eu = (_er&65535)>>>0;var _ev = imul(_eu,_et)>>>0;var _ew = (_es&65535)>>>0;var _ex = _er>>>16;var _ey = imul(_ex,_ew)>>>0;var _ez = _ev>>>16;var _eA = _ey>>>16;var _eB = imul(_ex,_et)>>>0;var _eC = _eB+_eA>>>0;var _eD = _eC+_ez>>>0;var _eE = imul(_eu,_ew)>>>0;var _eF = [1,E(_eE),E(_cV)];var _eG = (_ev&65535)>>>0;var _eH = _eG<<16>>>0;var _eI = (_ey&65535)>>>0;var _eJ = _eI<<16>>>0;var _eK = _db(0,_eJ,_cV,_eH,_cV);var _eL = _dl(0,_eK,_eF);var _eM = _eD==0;if(_eM){var _eN = E(_eL);}else{var _eO = [1,E(_eD),E(_cV)];var _eP = [1,E(0),E(_eO)];var _eN = _dl(0,_eP,_eL);}return _eN;};var _eQ = function(_eR,_eS){while(1){var _eT = E(_eR);if(_eT[0]==1){var _eU = _eT[1];var _eV = _eT[2];var _eW = E(_eS);if(_eW[0]==1){var _eX = _eW[1];var _eY = _eW[2];var _eZ = E(_eV);if(_eZ[0]==1){var _f0 = E(_eY);if(_f0[0]==1){var _f1 = _eQ(_eZ,_eW);var _f2 = [1,E(0),E(_f1)];var _f3 = [1,E(_eU),E(_cV)];var _f4 = _eQ(_f3,_eW);var _f5 = _dl(0,_f4,_f2);var _f6 = _f5;}else{var _f7 = _eU==0;if(_f7){var _f8 = _eQ(_eZ,_eW);var _f9 = [1,E(0),E(_f8)];var _fa = _f9;}else{var _fb = _eQ(_eZ,_eW);var _fc = [1,E(0),E(_fb)];var _fd = _eq(_eU,_eX);var _fe = _dl(0,_fd,_fc);var _fa = _fe;}var _f6 = _fa;}var _ff = _f6;}else{var _fg = E(_eY);if(_fg[0]==1){_eR=_eW;_eS=_eT;continue;var _fh = die("Unreachable!");}else{var _fh = _eq(_eU,_eX);}var _ff = _fh;}var _fi = _ff;}else{var _fi = E(_cW);}var _fj = _fi;}else{var _fk = E(_eS);var _fj = _fk[0]==1?E(_cW):E(_cW);}return _fj;}};var _fl = function(_fm,_fn){var _fo = E(_fm);switch(_fo[0]){case 1:var _fp = _fo[1];var _fq = E(_fn);switch(_fq[0]){case 1:var _fr = _fq[1];var _fs = _eQ(_fp,_fr);var _ft = [1,E(_fs)];var _fu = _ft;break;case 2:var _fv = _fq[1];var _fw = _eQ(_fp,_fv);var _fx = [2,E(_fw)];var _fu = _fx;break;case 3:var _fu = [3];break;}var _fy = _fu;break;case 2:var _fz = _fo[1];var _fA = E(_fn);switch(_fA[0]){case 1:var _fB = _fA[1];var _fC = _eQ(_fz,_fB);var _fD = [2,E(_fC)];var _fE = _fD;break;case 2:var _fF = _fA[1];var _fG = _eQ(_fz,_fF);var _fH = [1,E(_fG)];var _fE = _fH;break;case 3:var _fE = [3];break;}var _fy = _fE;break;case 3:var _fI = E(_fn);var _fJ = [3];var _fy = _fJ;break;}return _fy;};var _fK = function(_fL,_fM,_fN){while(1){var _fO = _fM%2;if(_fO){var _fP = E(_fM);if(_fP==1){var _fQ = _fl(_fL,_fN);}else{var _fR = _fl(_fL,_fN);var _fS = _fP-1|0;var _fT = quot(_fS,2);var _fU = _fl(_fL,_fL);_fL=_fU;_fM=_fT;_fN=_fR;continue;var _fV = die("Unreachable!");var _fQ = _fV;}var _fW = _fQ;}else{var _fX = quot(_fM,2);var _fY = _fl(_fL,_fL);_fL=_fY;_fM=_fX;_fN=_fN;continue;var _fZ = die("Unreachable!");var _fW = _fZ;}return _fW;}};var _g0 = function(_g1,_g2){while(1){var _g3 = _g2%2;if(_g3){var _g4 = E(_g2);if(_g4==1){var _g5 = E(_g1);}else{var _g6 = _g4-1|0;var _g7 = quot(_g6,2);var _g8 = _fl(_g1,_g1);var _g9 = _fK(_g8,_g7,_g1);var _g5 = _g9;}var _ga = _g5;}else{var _gb = quot(_g2,2);var _gc = _fl(_g1,_g1);_g1=_gc;_g2=_gb;continue;var _gd = die("Unreachable!");var _ga = _gd;}return _ga;}};var _ge = T(function(){return unCStr("Negative exponent");});var _gf = T(function(){return err(_ge);});var _gg = function(_gh){var _gi = newArr(1101,_ar,_gh);var _gj = _gi[1];var _gk = _gi[2];var _gl = function(_gm,_gn){while(1){var _go = 0<=_gm;if(_go){var _gp = _gm<=1100;if(_gp){var _gq = (function(_gm){return T(function(){var _gr = _gm<0;if(_gr){var _gs = E(_gf);}else{var _gt = E(_gm);var _gs = _gt?_g0(_ap,_gt):E(_cU);}return _gs;})})(_gm);var _gu = (_gk[_gm]=_gq);var _gv = E(_gm);if(_gv==1100){var _gw = [0,0,_gk];var _gx = _gw[1];var _gy = _gw[2];var _gz = [1,E(_84),E(_c1),1101,_gy];var _gA = [1,_gx,_gz];var _gB = _gA;}else{var _gC = _gv+1|0;_gm=_gC;_gn=_gu;continue;var _gD = die("Unreachable!");var _gB = _gD;}var _gE = _gB;}else{var _gE = _cR(_gm);}var _gF = _gE;}else{var _gF = _cR(_gm);}return _gF;}};var _gG = _gl(0,_gj);return _gG;};var _gH = function(_gI){var _gJ = A(_gI,[realWorld]);var _gK = _gJ[2];var _gL = E(_gK);return _gL;};var _gM = T(function(){return _gH(_gg);});var _gN = I(10);var _gO = [1,324];var _gP = [1,_84,_gO];var _gQ = function(_gR){var _gS = [1,_gR];return _bW(_cQ,_gP,_gS,_c3);};var _gT = function(_gU){var _gV = newArr(325,_ar,_gU);var _gW = _gV[1];var _gX = _gV[2];var _gY = function(_gZ,_h0){while(1){var _h1 = 0<=_gZ;if(_h1){var _h2 = _gZ<=324;if(_h2){var _h3 = (function(_gZ){return T(function(){var _h4 = _gZ<0;if(_h4){var _h5 = E(_gf);}else{var _h6 = E(_gZ);var _h5 = _h6?_g0(_gN,_h6):E(_cU);}return _h5;})})(_gZ);var _h7 = (_gX[_gZ]=_h3);var _h8 = E(_gZ);if(_h8==324){var _h9 = [0,0,_gX];var _ha = _h9[1];var _hb = _h9[2];var _hc = [1,E(_84),E(_gO),325,_hb];var _hd = [1,_ha,_hc];var _he = _hd;}else{var _hf = _h8+1|0;_gZ=_hf;_h0=_h7;continue;var _hg = die("Unreachable!");var _he = _hg;}var _hh = _he;}else{var _hh = _gQ(_gZ);}var _hi = _hh;}else{var _hi = _gQ(_gZ);}return _hi;}};var _hj = _gY(0,_gW);return _hj;};var _hk = T(function(){return _gH(_gT);});var _hl = function(_hm,_hn,_ho){var _hp = [1,_hn,_ho];return _bW(_cQ,_hp,_hm,_c3);};var _hq = function(_hr,_hs,_ht){var _hu = [1,_hs,_ht];return _bW(_cQ,_hu,_hr,_c3);};var _hv = function(_hw,_hx){var _hy = E(_hw);if(_hy[0]==1){var _hz = _hy[1];var _hA = _hy[2];var _hB = E(_hx);if(_hB[0]==1){var _hC = _hB[1];var _hD = _hB[2];var _hE = _hv(_hA,_hD);if(_hE[0]==2){var _hF = _hz<_hC;if(_hF){var _hG = [1];}else{var _hH = _hz>_hC;var _hG = _hH?[3]:[2];}var _hI = _hG;}else{var _hI = E(_hE);}var _hJ = _hI;}else{var _hJ = [3];}var _hK = _hJ;}else{var _hL = E(_hx);var _hK = _hL[0]==1?[1]:[2];}return _hK;};var _hM = function(_hN,_hO){var _hP = E(_hN);switch(_hP[0]){case 1:var _hQ = _hP[1];var _hR = E(_hO);if(_hR[0]==1){var _hS = _hR[1];var _hT = _hv(_hQ,_hS);}else{var _hT = [3];}var _hU = _hT;break;case 2:var _hV = _hP[1];var _hW = E(_hO);if(_hW[0]==2){var _hX = _hW[1];var _hY = _hv(_hX,_hV);}else{var _hY = [1];}var _hU = _hY;break;case 3:var _hZ = E(_hO);switch(_hZ[0]){case 1:var _i0 = [1];break;case 2:var _i0 = [3];break;case 3:var _i0 = [2];break;}var _hU = _i0;break;}return _hU;};var _i1 = function(_i2,_i3){var _i4 = _hM(_i2,_i3);return _i4[0]==2?true:false;};var _i5 = function(_i6,_i7){var _i8 = [1,_i7];var _i9 = T(function(){var _ia = _i1(_i6,_gN);if(_ia){var _ib = _i7<=324;if(_ib){var _ic = E(_hk);var _id = _ic[1];var _ie = _ic[2];var _if = _ic[4];var _ig = E(_id);var _ih = _ig[1];var _ii = E(_ie);var _ij = _ii[1];var _ik = _ih<=_i7;if(_ik){var _il = _i7<=_ij;if(_il){var _im = _i7-_ih|0;var _in = [0,_if[_im]];var _io = _in[1];var _ip = E(_io);var _iq = _ip;}else{var _iq = _hl(_i8,_ig,_ii);}var _ir = _iq;}else{var _ir = _hl(_i8,_ig,_ii);}var _is = _ir;}else{var _it = _i7<0;if(_it){var _iu = E(_gf);}else{var _iv = E(_i7);var _iu = _iv?_g0(_i6,_iv):E(_cU);}var _is = _iu;}var _iw = _is;}else{var _ix = _i7<0;if(_ix){var _iy = E(_gf);}else{var _iz = E(_i7);var _iy = _iz?_g0(_i6,_iz):E(_cU);}var _iw = _iy;}return _iw;});var _iA = _i1(_i6,_ap);if(_iA){var _iB = _i7>=0;if(_iB){var _iC = _i7<=1100;if(_iC){var _iD = E(_gM);var _iE = _iD[1];var _iF = _iD[2];var _iG = _iD[4];var _iH = E(_iE);var _iI = _iH[1];var _iJ = E(_iF);var _iK = _iJ[1];var _iL = _iI<=_i7;if(_iL){var _iM = _i7<=_iK;if(_iM){var _iN = _i7-_iI|0;var _iO = [0,_iG[_iN]];var _iP = _iO[1];var _iQ = E(_iP);var _iR = _iQ;}else{var _iR = _hq(_i8,_iH,_iJ);}var _iS = _iR;}else{var _iS = _hq(_i8,_iH,_iJ);}var _iT = _iS;}else{var _iT = E(_i9);}var _iU = _iT;}else{var _iU = E(_i9);}var _iV = _iU;}else{var _iV = E(_i9);}return _iV;};var _iW = T(function(){return _i5(_ap,52);});var _iX = I(4);var _iY = [2,_84,_U];var _iZ = function(_j0,_j1,_j2){var _j3 = E(_j0);if(_j3[0]==1){var _j4 = _j3[1];var _j5 = _j3[2];var _j6 = _j4==_j1;if(_j6){var _j7 = _j8(_j5,_j2);var _j9 = _j7[0]==1?[1,E(0),E(_j7)]:[2];}else{var _ja = _j4>_j1;if(_ja){var _jb = _j8(_j5,_j2);var _jc = _j4-_j1>>>0;var _jd = [1,E(_jc),E(_jb)];var _je = _jd;}else{var _jf = _j8(_j5,_j2);var _jg = _iZ(_jf,1,_cV);var _jh = 4294967295-_j1>>>0;var _ji = _jh+1>>>0;var _jj = _ji+_j4>>>0;var _jk = [1,E(_jj),E(_jg)];var _je = _jk;}var _j9 = _je;}var _jl = _j9;}else{var _jl = E(_cW);}return _jl;};var _j8 = function(_jm,_jn){var _jo = E(_jm);if(_jo[0]==1){var _jp = _jo[1];var _jq = _jo[2];var _jr = E(_jn);if(_jr[0]==1){var _js = _jr[1];var _jt = _jr[2];var _ju = _jp==_js;if(_ju){var _jv = _j8(_jq,_jt);var _jw = _jv[0]==1?[1,E(0),E(_jv)]:[2];}else{var _jx = _jp>_js;if(_jx){var _jy = _j8(_jq,_jt);var _jz = _jp-_js>>>0;var _jA = [1,E(_jz),E(_jy)];var _jB = _jA;}else{var _jC = _j8(_jq,_jt);var _jD = _iZ(_jC,1,_cV);var _jE = 4294967295-_js>>>0;var _jF = _jE+1>>>0;var _jG = _jF+_jp>>>0;var _jH = [1,E(_jG),E(_jD)];var _jB = _jH;}var _jw = _jB;}var _jI = _jw;}else{var _jI = E(_jo);}var _jJ = _jI;}else{var _jK = E(_jn);var _jJ = _jK[0]==1?E(_cW):[2];}return _jJ;};var _jL = function(_jM,_jN){while(1){var _jO = E(_jM);switch(_jO[0]){case 1:var _jP = _jO[1];var _jQ = E(_jN);switch(_jQ[0]){case 1:var _jR = _jQ[1];var _jS = _dl(0,_jP,_jR);var _jT = [1,E(_jS)];var _jU = _jT;break;case 2:var _jV = _jQ[1];var _jW = _hv(_jP,_jV);switch(_jW[0]){case 1:var _jX = _j8(_jV,_jP);var _jY = [2,E(_jX)];var _jZ = _jY;break;case 2:var _jZ = [3];break;case 3:var _k0 = _j8(_jP,_jV);var _k1 = [1,E(_k0)];var _jZ = _k1;break;}var _jU = _jZ;break;case 3:var _jU = E(_jO);break;}var _k2 = _jU;break;case 2:var _k3 = _jO[1];var _k4 = E(_jN);switch(_k4[0]){case 1:var _k5 = _k4[1];var _k6 = [2,E(_k3)];var _k7 = [1,E(_k5)];_jM=_k7;_jN=_k6;continue;var _k8 = die("Unreachable!");break;case 2:var _k9 = _k4[1];var _ka = _dl(0,_k3,_k9);var _kb = [2,E(_ka)];var _k8 = _kb;break;case 3:var _k8 = E(_jO);break;}var _k2 = _k8;break;case 3:var _k2 = E(_jN);break;}return _k2;}};var _kc = function(_kd){var _ke = E(_kd);switch(_ke[0]){case 1:var _kf = _ke[1];var _kg = [2,E(_kf)];break;case 2:var _kh = _ke[1];var _kg = [1,E(_kh)];break;case 3:var _kg = [3];break;}return _kg;};var _ki = function(_kj){var _kk = _kj==0;if(_kk){var _kl = [3];}else{var _km = [1,E(_kj),E(_cV)];var _kl = [1,E(_km)];}return _kl;};var _kn = function(_ko){var _kp = _ko>=0;if(_kp){var _kq = _ko>>>0;var _kr = _ki(_kq);var _ks = _kr;}else{var _kt = -_ko;var _ku = _kt>>>0;var _kv = _ki(_ku);var _kw = _kc(_kv);var _ks = _kw;}return _ks;};var _kx = [1,E(0),E(_cX)];var _ky = [1,E(_kx)];var _kz = function(_kA){var _kB = decodeDouble(_kA);var _kC = _kB[1];var _kD = _kB[2];var _kE = _kB[3];var _kF = _kB[4];var _kG = T(function(){var _kH = _ki(_kE);var _kI = _ki(_kD);var _kJ = _fl(_kI,_ky);var _kK = _jL(_kJ,_kH);var _kL = _kn(_kC);var _kM = _fl(_kL,_kK);return _kM;});var _kN = [1,_kG,_kF];return _kN;};var _kO = function(_kP){var _kQ = E(_kP);if(_kQ[0]==1){var _kR = _kQ[1];var _kS = _kQ[2];var _kT = _kO(_kS);var _kU = (_kR&65535)>>>0;var _kV = _kU&4294967295;var _kW = _kV;var _kX = Math.pow(2,16);var _kY = _kR>>>16;var _kZ = _kY&4294967295;var _l0 = _kZ;var _l1 = _l0*_kX;var _l2 = Math.pow(2,32);var _l3 = _kT*_l2;var _l4 = _l3+_l1;var _l5 = _l4+_kW;var _l6 = _l5;}else{var _l6 = 0;}return _l6;};var _l7 = function(_l8){var _l9 = E(_l8);switch(_l9[0]){case 1:var _la = _l9[1];var _lb = _kO(_la);break;case 2:var _lc = _l9[1];var _ld = _kO(_lc);var _le = -_ld;var _lb = _le;break;case 3:var _lb = 0;break;}return _lb;};var _lf = function(_lg,_lh){var _li = _hM(_lg,_lh);return _li[0]==3?true:false;};var _lj = function(_lk,_ll){var _lm = _hM(_lk,_ll);return _lm[0]==3?false:true;};var _ln = function(_lo,_lp){var _lq = _hM(_lo,_lp);return _lq[0]==1?true:false;};var _lr = [3];var _ls = [1,E(_cW)];var _lt = [1];var _lu = function(_lv){var _lw = E(_lv);return _lw[0]==1?[1,E(_lw)]:[3];};var _lx = function(_ly,_lz,_lA){while(1){var _lB = E(_lz);if(_lB[0]==1){var _lC = E(_lA);var _lD = [1,_ly,_lC];var _lE = _lD;}else{var _lF = _lB[1];var _lG = _lB[2];var _lH = _hv(_lA,_lF);if(_lH[0]==1){var _lI = _ly<<1>>>0;_ly=_lI;_lz=_lG;_lA=_lA;continue;var _lJ = die("Unreachable!");var _lK = _lJ;}else{var _lL = _j8(_lA,_lF);var _lM = _ly<<1>>>0;var _lN = _lM+1>>>0;_ly=_lN;_lz=_lG;_lA=_lL;continue;var _lO = die("Unreachable!");var _lK = _lO;}var _lE = _lK;}return _lE;}};var _lP = function(_lQ,_lR){var _lS = E(_lR);if(_lS){var _lT = 32-_lS|0;var _lU = function(_lV,_lW){var _lX = E(_lW);if(_lX[0]==1){var _lY = _lX[1];var _lZ = _lX[2];var _m0 = _lY>>>_lT;var _m1 = _lU(_m0,_lZ);var _m2 = _lY<<_lS>>>0;var _m3 = (_m2|_lV)>>>0;var _m4 = [1,E(_m3),E(_m1)];var _m5 = _m4;}else{var _m6 = _lV==0;var _m5 = _m6?[2]:[1,E(_lV),E(_cV)];}return _m5;};var _m7 = _lU(0,_lQ);var _m8 = _m7;}else{var _m8 = E(_lQ);}return _m8;};var _m9 = function(_ma,_mb){var _mc = E(_mb);if(_mc[0]==1){var _md = [1,E(_ma),E(_mc)];}else{var _me = _ma==0;var _md = _me?[2]:[1,E(_ma),E(_cV)];}return _md;};var _mf = function(_mg,_mh){var _mi = E(_mh);var _mj = T(function(){var _mk = [2,_mi,_lt];var _ml = function(_mm){var _mn = E(_mm);if(_mn){var _mo = T(function(){var _mp = _mn-1|0;var _mq = _ml(_mp);return _mq;});var _mr = T(function(){return _lP(_mi,_mn);});var _ms = [2,_mr,_mo];}else{var _ms = E(_mk);}return _ms;};return _ml(31);});var _mt = function(_mu){var _mv = E(_mu);if(_mv[0]==1){var _mw = _mv[1];var _mx = _mv[2];var _my = _mt(_mx);var _mz = _my[1];var _mA = _my[2];var _mB = E(_mA);if(_mB[0]==1){var _mC = [1,E(_mw),E(_mB)];var _mD = _lx(0,_mj,_mC);var _mE = _mD[1];var _mF = _mD[2];var _mG = T(function(){return _m9(_mE,_mz);});var _mH = [1,_mG,_mF];var _mI = _mH;}else{var _mJ = _mw==0;if(_mJ){var _mK = _lx(0,_mj,_cV);var _mL = _mK[1];var _mM = _mK[2];var _mN = T(function(){return _m9(_mL,_mz);});var _mO = [1,_mN,_mM];var _mP = _mO;}else{var _mQ = [1,E(_mw),E(_cV)];var _mR = _lx(0,_mj,_mQ);var _mS = _mR[1];var _mT = _mR[2];var _mU = T(function(){return _m9(_mS,_mz);});var _mV = [1,_mU,_mT];var _mP = _mV;}var _mI = _mP;}var _mW = _mI;}else{var _mW = [1,_cV,_cV];}return _mW;};var _mX = _mt(_mg);var _mY = _mX[1];var _mZ = _mX[2];var _n0 = T(function(){return _lu(_mZ);});var _n1 = T(function(){return _lu(_mY);});var _n2 = [1,_n1,_n0];return _n2;};var _n3 = function(_n4,_n5){var _n6 = E(_n4);if(_n6[0]==3){var _n7 = E(_n5);var _n8 = [1,_lr,_lr];var _n9 = _n8;}else{var _na = E(_n5);if(_na[0]==3){var _nb = [1,_ls,_ls];}else{var _nc = E(_n6);if(_nc[0]==1){var _nd = _nc[1];var _ne = E(_na);if(_ne[0]==1){var _nf = _ne[1];var _ng = _mf(_nd,_nf);}else{var _nh = _ne[1];var _ni = _mf(_nd,_nh);var _nj = _ni[1];var _nk = _ni[2];var _nl = T(function(){return _kc(_nj);});var _nm = [1,_nl,_nk];var _ng = _nm;}var _nn = _ng;}else{var _no = _nc[1];var _np = E(_na);if(_np[0]==1){var _nq = _np[1];var _nr = _mf(_no,_nq);var _ns = _nr[1];var _nt = _nr[2];var _nu = T(function(){return _kc(_nt);});var _nv = T(function(){return _kc(_ns);});var _nw = [1,_nv,_nu];var _nx = _nw;}else{var _ny = _np[1];var _nz = _mf(_no,_ny);var _nA = _nz[1];var _nB = _nz[2];var _nC = T(function(){return _kc(_nB);});var _nD = [1,_nA,_nC];var _nx = _nD;}var _nn = _nx;}var _nb = _nn;}var _n9 = _nb;}return _n9;};var _nE = function(_nF,_nG){var _nH = _n3(_nF,_nG);var _nI = _nH[1];var _nJ = E(_nI);return _nJ;};var _nK = function(_nL,_nM){while(1){var _nN = E(_nL);if(_nN[0]==1){var _nO = E(_nM);}else{var _nP = _nN[1];var _nQ = _nN[2];var _nR = [2,_nP,_nM];_nL=_nQ;_nM=_nR;continue;var _nO = die("Unreachable!");}return _nO;}};var _nS = function(_nT){var _nU = E(_nT);switch(_nU[0]){case 1:var _nV = _nU[1];var _nW = E(_nV);if(_nW[0]==1){var _nX = _nW[1];var _nY = E(_nX);}else{var _nY = 0;}var _nZ = _nY;break;case 2:var _o0 = _nU[1];var _o1 = E(_o0);if(_o1[0]==1){var _o2 = _o1[1];var _o3 = 0-_o2>>>0;}else{var _o3 = 0;}var _nZ = _o3;break;case 3:var _nZ = 0;break;}return _nZ;};var _o4 = function(_o5){var _o6 = _nS(_o5);var _o7 = _o6&4294967295;return _o7;};var _o8 = function(_o9){var _oa = _o4(_o9);var _ob = [1,_oa];return _ob;};var _oc = I(0);var _od = function(_oe,_of){var _og = _of==0;if(_og){var _oh = [1,_iY,_84];}else{var _oi = T(function(){var _oj = _kz(_of);var _ok = _oj[1];var _ol = _oj[2];var _om = [1,_ol];var _on = [1,_ok,_om];return _on;});var _oo = T(function(){var _op = E(_oi);var _oq = _op[2];var _or = E(_oq);return _or;});var _os = T(function(){var _ot = E(_oo);var _ou = _ot[1];var _ov = (-1074)-_ou|0;var _ow = _ov>0;if(_ow){var _ox = _ou+_ov|0;var _oy = [1,_ox];var _oz = T(function(){var _oA = _i5(_ap,_ov);var _oB = _i1(_oA,_oc);if(_oB){var _oC = E(_an);}else{var _oD = E(_oi);var _oE = _oD[1];var _oF = _nE(_oE,_oA);var _oC = _oF;}return _oC;});var _oG = [1,_oz,_oy];var _oH = _oG;}else{var _oI = T(function(){var _oJ = E(_oi);var _oK = _oJ[1];var _oL = E(_oK);return _oL;});var _oH = [1,_oI,_ot];}return _oH;});var _oM = T(function(){var _oN = E(_os);var _oO = _oN[2];var _oP = E(_oO);return _oP;});var _oQ = T(function(){var _oR = E(_os);var _oS = _oR[1];var _oT = E(_oS);return _oT;});var _oU = T(function(){var _oV = E(_oM);var _oW = _oV[1];var _oX = _oW>=0;if(_oX){var _oY = T(function(){return _i5(_ap,_oW);});var _oZ = _i1(_oQ,_iW);if(_oZ){var _p0 = T(function(){return _fl(_oY,_ap);});var _p1 = T(function(){var _p2 = _fl(_oQ,_oY);var _p3 = _fl(_p2,_ap);var _p4 = _fl(_p3,_ap);return _p4;});var _p5 = [1,_p1,_iX,_p0,_oY];}else{var _p6 = T(function(){var _p7 = _fl(_oQ,_oY);var _p8 = _fl(_p7,_ap);return _p8;});var _p5 = [1,_p6,_ap,_oY,_oY];}var _p9 = _p5;}else{var _pa = _oW>(-1074);if(_pa){var _pb = _i1(_oQ,_iW);if(_pb){var _pc = T(function(){var _pd = -_oW;var _pe = _pd+1|0;var _pf = _i5(_ap,_pe);var _pg = _fl(_pf,_ap);return _pg;});var _ph = T(function(){var _pi = _fl(_oQ,_ap);var _pj = _fl(_pi,_ap);return _pj;});var _pk = [1,_ph,_pc,_ap,_ao];}else{var _pl = T(function(){var _pm = -_oW;var _pn = _i5(_ap,_pm);var _po = _fl(_pn,_ap);return _po;});var _pp = T(function(){return _fl(_oQ,_ap);});var _pk = [1,_pp,_pl,_ao,_ao];}var _pq = _pk;}else{var _pr = T(function(){var _ps = -_oW;var _pt = _i5(_ap,_ps);var _pu = _fl(_pt,_ap);return _pu;});var _pv = T(function(){return _fl(_oQ,_ap);});var _pq = [1,_pv,_pr,_ao,_ao];}var _p9 = _pq;}return _p9;});var _pw = T(function(){var _px = E(_oU);var _py = _px[2];var _pz = E(_py);return _pz;});var _pA = T(function(){var _pB = E(_oU);var _pC = _pB[3];var _pD = E(_pC);return _pD;});var _pE = T(function(){var _pF = E(_oU);var _pG = _pF[1];var _pH = E(_pG);return _pH;});var _pI = T(function(){var _pJ = T(function(){return _jL(_pE,_pA);});var _pK = function(_pL){while(1){var _pM = _pL>=0;if(_pM){var _pN = _i5(_oe,_pL);var _pO = _fl(_pN,_pw);var _pP = _lj(_pJ,_pO);if(_pP){var _pQ = E(_pL);}else{var _pR = _pL+1|0;_pL=_pR;continue;var _pS = die("Unreachable!");var _pQ = _pS;}var _pT = _pQ;}else{var _pU = -_pL;var _pV = _i5(_oe,_pU);var _pW = _fl(_pV,_pJ);var _pX = _lj(_pW,_pw);if(_pX){var _pY = E(_pL);}else{var _pZ = _pL+1|0;_pL=_pZ;continue;var _q0 = die("Unreachable!");var _pY = _q0;}var _pT = _pY;}return _pT;}};var _q1 = _i1(_oe,_gN);if(_q1){var _q2 = E(_oo);var _q3 = _q2[1];var _q4 = 52+_q3|0;var _q5 = _q4>=0;if(_q5){var _q6 = imul(_q4,8651)|0;var _q7 = quot(_q6,28738);var _q8 = _q7+1|0;var _q9 = _pK(_q8);var _qa = [1,_q9];var _qb = _qa;}else{var _qc = imul(_q4,8651)|0;var _qd = quot(_qc,28738);var _qe = _pK(_qd);var _qf = [1,_qe];var _qb = _qf;}var _qg = _qb;}else{var _qh = _jL(_oQ,_ao);var _qi = _l7(_qh);var _qj = E(_oM);var _qk = _qj[1];var _ql = _l7(_oe);var _qm = Math.log(_ql);var _qn = Math.log(_qi);var _qo = Math.log(2);var _qp = _qk;var _qq = _qp*_qo;var _qr = _qn+_qq;var _qs = _qr/_qm;var _qt = _qs;var _qu = _qt;var _qv = _qu<_qs;if(_qv){var _qw = _qt+1|0;var _qx = _pK(_qw);var _qy = [1,_qx];var _qz = _qy;}else{var _qA = _pK(_qt);var _qB = [1,_qA];var _qz = _qB;}var _qg = _qz;}return _qg;});var _qC = T(function(){var _qD = E(_pI);var _qE = _qD[1];var _qF = function(_qG,_qH,_qI,_qJ,_qK){while(1){var _qL = _i1(_qI,_oc);if(_qL){var _qM = E(_an);}else{var _qN = _fl(_qH,_oe);var _qO = _n3(_qN,_qI);var _qP = _qO[1];var _qQ = _qO[2];var _qR = _fl(_qK,_oe);var _qS = _fl(_qJ,_oe);var _qT = _ln(_qQ,_qR);if(_qT){var _qU = _jL(_qQ,_qS);var _qV = _lf(_qU,_qI);if(_qV){var _qW = _fl(_qQ,_ap);var _qX = _ln(_qW,_qI);if(_qX){var _qY = [2,_qP,_qG];}else{var _qZ = (function(_qP){return T(function(){return _jL(_qP,_ao);})})(_qP);var _qY = [2,_qZ,_qG];}var _r0 = _qY;}else{var _r0 = [2,_qP,_qG];}var _r1 = _r0;}else{var _r2 = _jL(_qQ,_qS);var _r3 = _lf(_r2,_qI);if(_r3){var _r4 = (function(_qP){return T(function(){return _jL(_qP,_ao);})})(_qP);var _r5 = [2,_r4,_qG];}else{var _r6 = [2,_qP,_qG];_qG=_r6;_qH=_qQ;_qI=_qI;_qJ=_qS;_qK=_qR;continue;var _r5 = die("Unreachable!");}var _r1 = _r5;}var _qM = _r1;}return _qM;}};var _r7 = _qE>=0;if(_r7){var _r8 = E(_oU);var _r9 = _r8[4];var _ra = _i5(_oe,_qE);var _rb = _fl(_pw,_ra);var _rc = _qF(_U,_pE,_rb,_pA,_r9);var _rd = _nK(_rc,_U);var _re = _61(_o8,_rd);var _rf = _re;}else{var _rg = E(_oU);var _rh = _rg[4];var _ri = -_qE;var _rj = _i5(_oe,_ri);var _rk = _fl(_rh,_rj);var _rl = _fl(_pA,_rj);var _rm = _fl(_pE,_rj);var _rn = _qF(_U,_rm,_pw,_rl,_rk);var _ro = _nK(_rn,_U);var _rp = _61(_o8,_ro);var _rf = _rp;}return _rf;});var _oh = [1,_qC,_pI];}return _oh;};var _rq = [1,'.'];var _rr = [1,'0'];var _rs = [2,_rr,_U];var _rt = function(_ru,_rv){while(1){var _rw = E(_ru);if(_rw){var _rx = [2,_rr,_rv];var _ry = _rw-1|0;_ru=_ry;_rv=_rx;continue;var _rz = die("Unreachable!");var _rA = _rz;}else{var _rB = _nK(_rv,_U);if(_rB[0]==1){var _rC = [2,_rq,_rs];var _rD = [2,_rr,_rC];}else{var _rE = [2,_rq,_rs];var _rD = _15(_rB,_rE);}var _rA = _rD;}return _rA;}};var _rF = function(_rG,_rH,_rI){while(1){var _rJ = E(_rG);if(_rJ){var _rK = E(_rI);if(_rK[0]==1){var _rL = [2,_rr,_rH];var _rM = _rJ-1|0;var _rN = _rt(_rM,_rL);var _rO = _rN;}else{var _rP = _rK[1];var _rQ = _rK[2];var _rR = [2,_rP,_rH];var _rS = _rJ-1|0;_rG=_rS;_rH=_rR;_rI=_rQ;continue;var _rT = die("Unreachable!");var _rO = _rT;}var _rU = _rO;}else{var _rV = _nK(_rH,_U);if(_rV[0]==1){var _rW = (function(_rI){return T(function(){var _rX = E(_rI);return _rX[0]==1?E(_rs):E(_rX);})})(_rI);var _rY = [2,_rq,_rW];var _rZ = [2,_rr,_rY];}else{var _s0 = (function(_rI){return T(function(){var _s1 = E(_rI);return _s1[0]==1?E(_rs):E(_s1);})})(_rI);var _s2 = [2,_rq,_s0];var _rZ = _15(_rV,_s2);}var _rU = _rZ;}return _rU;}};var _s3 = function(_s4,_s5){var _s6 = _s4>0;if(_s6){var _s7 = _s5<0;if(_s7){var _s8 = _s4-1|0;var _s9 = quot(_s8,_s5);var _sa = _s9-1|0;var _sb = _sa;}else{var _sc = _s4<0;if(_sc){var _sd = _s5>0;if(_sd){var _se = _s4+1|0;var _sf = quot(_se,_s5);var _sg = _sf-1|0;var _sh = _sg;}else{var _sh = quot(_s4,_s5);}var _si = _sh;}else{var _si = quot(_s4,_s5);}var _sb = _si;}var _sj = _sb;}else{var _sk = _s4<0;if(_sk){var _sl = _s5>0;if(_sl){var _sm = _s4+1|0;var _sn = quot(_sm,_s5);var _so = _sn-1|0;var _sp = _so;}else{var _sp = quot(_s4,_s5);}var _sq = _sp;}else{var _sq = quot(_s4,_s5);}var _sj = _sq;}return _sj;};var _sr = [1,1];var _ss = [2,_84,_U];var _st = function(_su){var _sv = _su<=1;if(_sv){var _sw = E(_ss);}else{var _sx = T(function(){var _sy = _su-1|0;var _sz = _st(_sy);return _sz;});var _sw = [2,_84,_sx];}return _sw;};var _sA = function(_sB,_sC,_sD){var _sE = T(function(){var _sF = E(_sB);var _sG = _sF[1];var _sH = _s3(_sG,2);var _sI = [1,_sH];return _sI;});var _sJ = function(_sK,_sL){var _sM = E(_sL);if(_sM[0]==1){var _sN = T(function(){var _sO = _sK<=0;return _sO?[1]:_st(_sK);});var _sP = [1,_84,_sN];}else{var _sQ = _sM[1];var _sR = _sM[2];var _sS = E(_sK);if(_sS){var _sT = _sS-1|0;var _sU = _sJ(_sT,_sR);var _sV = _sU[1];var _sW = _sU[2];var _sX = E(_sV);var _sY = _sX[1];var _sZ = E(_sQ);var _t0 = _sZ[1];var _t1 = E(_sB);var _t2 = _t1[1];var _t3 = _sY+_t0|0;var _t4 = _t3==_t2;if(_t4){var _t5 = [2,_84,_sW];var _t6 = [1,_sr,_t5];}else{var _t7 = [1,_t3];var _t8 = [2,_t7,_sW];var _t6 = [1,_84,_t8];}var _t9 = _t6;}else{var _ta = T(function(){var _tb = E(_sQ);var _tc = _tb[1];var _td = E(_sE);var _te = _td[1];var _tf = _tc>=_te;var _tg = _tf?E(_sr):E(_84);return _tg;});var _t9 = [1,_ta,_U];}var _sP = _t9;}return _sP;};var _th = E(_sD);if(_th[0]==1){var _ti = T(function(){var _tj = E(_sC);var _tk = _tj[1];var _tl = _tk<=0;var _tm = _tl?[1]:_st(_tk);return _tm;});var _tn = [1,_84,_ti];}else{var _to = _th[1];var _tp = _th[2];var _tq = E(_sC);var _tr = _tq[1];var _ts = E(_tr);if(_ts){var _tt = _ts-1|0;var _tu = _sJ(_tt,_tp);var _tv = _tu[1];var _tw = _tu[2];var _tx = E(_tv);var _ty = _tx[1];var _tz = E(_to);var _tA = _tz[1];var _tB = E(_sB);var _tC = _tB[1];var _tD = _ty+_tA|0;var _tE = _tD==_tC;if(_tE){var _tF = [2,_84,_tw];var _tG = [2,_sr,_tF];var _tH = [1,_sr,_tG];}else{var _tI = [1,_tD];var _tJ = [2,_tI,_tw];var _tH = [1,_84,_tJ];}var _tK = _tH;}else{var _tL = E(_to);var _tM = _tL[1];var _tN = E(_sE);var _tO = _tN[1];var _tP = _tM>=_tO;if(_tP){var _tQ = [2,_sr,_U];var _tR = [1,_sr,_tQ];}else{var _tR = [1,_84,_U];}var _tK = _tR;}var _tn = _tK;}return _tn;};var _tS = [1,10];var _tT = T(function(){return unCStr("e0");});var _tU = function(_tV,_tW){var _tX = E(_tV);if(_tX[0]==1){var _tY = E(_tT);}else{var _tZ = _tX[1];var _u0 = _tX[2];var _u1 = _tW<=1;if(_u1){var _u2 = [2,_tZ,_tT];}else{var _u3 = T(function(){var _u4 = _tW-1|0;var _u5 = _tU(_u0,_u4);return _u5;});var _u2 = [2,_tZ,_u3];}var _tY = _u2;}return _tY;};var _u6 = T(function(){return unCStr("formatRealFloat/doFmt/FFExponent: []");});var _u7 = T(function(){return err(_u6);});var _u8 = T(function(){return unCStr("0.0e0");});var _u9 = T(function(){return _7Z("GHC/Float.lhs:603:12-70|(d : ds')");});var _ua = [1,'e'];var _ub = T(function(){return _kn(10);});var _uc = T(function(){return unCStr("Infinity");});var _ud = T(function(){return unCStr("-Infinity");});var _ue = T(function(){return unCStr("NaN");});var _uf = T(function(){return [2,_rr,_uf];});var _ug = function(_uh,_ui){var _uj = E(_uh);if(_uj){var _uk = E(_ui);if(_uk[0]==1){var _ul = [1,_U,_U];}else{var _um = _uk[1];var _un = _uk[2];var _uo = T(function(){var _up = _uj-1|0;var _uq = _ug(_up,_un);var _ur = _uq[1];var _us = _uq[2];var _ut = [1,_ur,_us];return _ut;});var _uu = T(function(){var _uv = E(_uo);var _uw = _uv[2];var _ux = E(_uw);return _ux;});var _uy = T(function(){var _uz = E(_uo);var _uA = _uz[1];var _uB = E(_uA);return _uB;});var _uC = [2,_um,_uy];var _ul = [1,_uC,_uu];}var _uD = _ul;}else{var _uD = [1,_U,_ui];}return _uD;};var _uE = function(_uF,_uG){var _uH = E(_uG);if(_uH[0]==1){var _uI = [1];}else{var _uJ = _uH[1];var _uK = _uH[2];var _uL = T(function(){return _uE(_uJ,_uK);});var _uI = [2,_uF,_uL];}return _uI;};var _uM = T(function(){return unCStr("init");});var _uN = T(function(){return _aK(_uM);});var _uO = function(_uP,_uQ,_uR){var _uS = isDoubleNaN(_uR,realWorld);var _uT = _uS[2];var _uU = E(_uT);if(_uU){var _uV = E(_ue);}else{var _uW = isDoubleInfinite(_uR,realWorld);var _uX = _uW[2];var _uY = E(_uX);if(_uY){var _uZ = _uR<0;var _v0 = _uZ?E(_ud):E(_uc);}else{var _v1 = function(_v2,_v3){var _v4 = E(_uQ);if(_v4[0]==1){var _v5 = _61(_8Z,_v2);if(_v5[0]==1){var _v6 = E(_u7);}else{var _v7 = _v5[1];var _v8 = _v5[2];var _v9 = E(_v7);var _va = _v9[1];var _vb = T(function(){var _vc = E(_v8);if(_vc[0]==1){var _vd = T(function(){var _ve = T(function(){var _vf = _v3-1|0;var _vg = _c4(0,_vf,_U);return _vg;});return unAppCStr(".0e",_ve);});var _vh = [2,_v9,_vd];}else{var _vi = T(function(){var _vj = T(function(){var _vk = _v3-1|0;var _vl = _8m(_vk,_U);return _vl;});var _vm = [2,_ua,_vj];return _15(_vc,_vm);});var _vn = [2,_rq,_vi];var _vh = [2,_v9,_vn];}return _vh;});var _vo = E(_va);if(_vo=='0'){var _vp = E(_v8);var _vq = _vp[0]==1?E(_u8):E(_vb);}else{var _vq = E(_vb);}var _v6 = _vq;}var _vr = _v6;}else{var _vs = _v4[1];var _vt = T(function(){var _vu = E(_vs);var _vv = _vu[1];var _vw = _vv<=1;var _vx = _vw?E(_sr):E(_vu);return _vx;});var _vy = T(function(){var _vz = T(function(){var _vA = E(_vt);var _vB = _vA[1];var _vC = _vB+1|0;var _vD = [1,_vC];return _vD;});var _vE = _sA(_tS,_vz,_v2);var _vF = _vE[1];var _vG = _vE[2];var _vH = [1,_vF,_vG];return _vH;});var _vI = T(function(){var _vJ = E(_vy);var _vK = _vJ[1];var _vL = E(_vK);return _vL;});var _vM = T(function(){var _vN = E(_vI);var _vO = _vN[1];var _vP = _vO>0;if(_vP){var _vQ = E(_vy);var _vR = _vQ[2];var _vS = E(_vR);if(_vS[0]==1){var _vT = E(_uN);}else{var _vU = _vS[1];var _vV = _vS[2];var _vW = _uE(_vU,_vV);var _vX = _61(_8Z,_vW);if(_vX[0]==1){var _vY = E(_u9);}else{var _vZ = _vX[1];var _w0 = _vX[2];var _vY = [1,_vZ,_w0];}var _vT = _vY;}var _w1 = _vT;}else{var _w2 = E(_vy);var _w3 = _w2[2];var _w4 = _61(_8Z,_w3);if(_w4[0]==1){var _w5 = E(_u9);}else{var _w6 = _w4[1];var _w7 = _w4[2];var _w5 = [1,_w6,_w7];}var _w1 = _w5;}return _w1;});var _w8 = T(function(){var _w9 = E(_vM);var _wa = _w9[2];var _wb = T(function(){var _wc = E(_vI);var _wd = _wc[1];var _we = _v3-1|0;var _wf = _we+_wd|0;var _wg = _8m(_wf,_U);return _wg;});var _wh = [2,_ua,_wb];var _wi = _15(_wa,_wh);return _wi;});var _wj = E(_v2);if(_wj[0]==1){var _wk = [2,_rq,_w8];var _wl = T(function(){var _wm = E(_vM);var _wn = _wm[1];var _wo = E(_wn);return _wo;});var _wp = [2,_wl,_wk];}else{var _wq = _wj[1];var _wr = _wj[2];var _ws = E(_wq);var _wt = _ws[1];var _wu = E(_wt);if(_wu){var _wv = [2,_rq,_w8];var _ww = T(function(){var _wx = E(_vM);var _wy = _wx[1];var _wz = E(_wy);return _wz;});var _wA = [2,_ww,_wv];}else{var _wB = E(_wr);if(_wB[0]==1){var _wC = T(function(){var _wD = E(_vt);var _wE = _wD[1];var _wF = _wE<=0;var _wG = _wF?E(_tT):_tU(_uf,_wE);return _wG;});var _wH = [2,_rq,_wC];var _wI = [2,_rr,_wH];}else{var _wJ = [2,_rq,_w8];var _wK = T(function(){var _wL = E(_vM);var _wM = _wL[1];var _wN = E(_wM);return _wN;});var _wI = [2,_wK,_wJ];}var _wA = _wI;}var _wp = _wA;}var _vr = _wp;}return _vr;};var _wO = function(_wP,_wQ){var _wR = E(_uQ);if(_wR[0]==1){var _wS = _wQ<=0;if(_wS){var _wT = T(function(){var _wU = -_wQ;var _wV = _wU<=0;if(_wV){var _wW = _61(_8Z,_wP);}else{var _wX = T(function(){return _61(_8Z,_wP);});var _wY = [2,_rr,_wX];var _wZ = function(_x0){var _x1 = _x0<=1;if(_x1){var _x2 = E(_wY);}else{var _x3 = T(function(){var _x4 = _x0-1|0;var _x5 = _wZ(_x4);return _x5;});var _x2 = [2,_rr,_x3];}return _x2;};var _wW = _wZ(_wU);}return _wW;});var _x6 = unAppCStr("0.",_wT);}else{var _x7 = T(function(){return _61(_8Z,_wP);});var _x6 = _rF(_wQ,_U,_x7);}var _x8 = _x6;}else{var _x9 = _wR[1];var _xa = _wQ>=0;if(_xa){var _xb = T(function(){var _xc = E(_x9);var _xd = _xc[1];var _xe = _xd<=0;if(_xe){var _xf = [1,_wQ];}else{var _xg = _xd+_wQ|0;var _xh = [1,_xg];var _xf = _xh;}return _xf;});var _xi = _sA(_tS,_xb,_wP);var _xj = _xi[1];var _xk = _xi[2];var _xl = E(_xj);var _xm = _xl[1];var _xn = _wQ+_xm|0;var _xo = _xn<0;if(_xo){var _xp = T(function(){var _xq = _61(_8Z,_xk);return _xq[0]==1?[1]:[2,_rq,_xq];});var _xr = [2,_rr,_xp];}else{var _xs = T(function(){return _61(_8Z,_xk);});var _xt = _ug(_xn,_xs);var _xu = _xt[1];var _xv = _xt[2];var _xw = E(_xu);if(_xw[0]==1){var _xx = T(function(){var _xy = E(_xv);return _xy[0]==1?[1]:[2,_rq,_xy];});var _xz = [2,_rr,_xx];}else{var _xA = T(function(){var _xB = E(_xv);return _xB[0]==1?[1]:[2,_rq,_xB];});var _xz = _15(_xw,_xA);}var _xr = _xz;}var _xC = _xr;}else{var _xD = T(function(){var _xE = -_wQ;var _xF = _xE<=0;if(_xF){var _xG = T(function(){var _xH = E(_x9);var _xI = _xH[1];var _xJ = _xI<=0;var _xK = _xJ?E(_84):E(_xH);return _xK;});var _xL = _sA(_tS,_xG,_wP);var _xM = _xL[1];var _xN = _xL[2];var _xO = _95(_xM,_xN);var _xP = _xO;}else{var _xQ = [2,_84,_wP];var _xR = function(_xS){var _xT = _xS<=1;if(_xT){var _xU = E(_xQ);}else{var _xV = T(function(){var _xW = _xS-1|0;var _xX = _xR(_xW);return _xX;});var _xU = [2,_84,_xV];}return _xU;};var _xY = _xR(_xE);var _xZ = T(function(){var _y0 = E(_x9);var _y1 = _y0[1];var _y2 = _y1<=0;var _y3 = _y2?E(_84):E(_y0);return _y3;});var _y4 = _sA(_tS,_xZ,_xY);var _y5 = _y4[1];var _y6 = _y4[2];var _y7 = _95(_y5,_y6);var _xP = _y7;}return _xP;});var _y8 = T(function(){var _y9 = E(_xD);var _ya = _y9[2];var _yb = E(_ya);var _yc = _yb[0]==1?[1]:[2,_rq,_yb];return _yc;});var _yd = T(function(){var _ye = E(_xD);var _yf = _ye[1];var _yg = E(_yf);return _yg;});var _xC = [2,_yd,_y8];}var _x8 = _xC;}return _x8;};var _yh = function(_yi,_yj,_yk){var _yl = E(_yi);switch(_yl[0]){case 1:var _ym = E(_uQ);if(_ym[0]==1){var _yn = _61(_8Z,_yj);if(_yn[0]==1){var _yo = E(_u7);}else{var _yp = _yn[1];var _yq = _yn[2];var _yr = E(_yp);var _ys = _yr[1];var _yt = T(function(){var _yu = E(_yq);if(_yu[0]==1){var _yv = T(function(){var _yw = T(function(){var _yx = E(_yk);var _yy = _yx[1];var _yz = _yy-1|0;var _yA = _c4(0,_yz,_U);return _yA;});return unAppCStr(".0e",_yw);});var _yB = [2,_yr,_yv];}else{var _yC = T(function(){var _yD = T(function(){var _yE = E(_yk);var _yF = _yE[1];var _yG = _yF-1|0;var _yH = _8m(_yG,_U);return _yH;});var _yI = [2,_ua,_yD];return _15(_yu,_yI);});var _yJ = [2,_rq,_yC];var _yB = [2,_yr,_yJ];}return _yB;});var _yK = E(_ys);if(_yK=='0'){var _yL = E(_yq);var _yM = _yL[0]==1?E(_u8):E(_yt);}else{var _yM = E(_yt);}var _yo = _yM;}var _yN = _yo;}else{var _yO = _ym[1];var _yP = T(function(){var _yQ = E(_yO);var _yR = _yQ[1];var _yS = _yR<=1;var _yT = _yS?E(_sr):E(_yQ);return _yT;});var _yU = T(function(){var _yV = T(function(){var _yW = E(_yP);var _yX = _yW[1];var _yY = _yX+1|0;var _yZ = [1,_yY];return _yZ;});var _z0 = _sA(_tS,_yV,_yj);var _z1 = _z0[1];var _z2 = _z0[2];var _z3 = [1,_z1,_z2];return _z3;});var _z4 = T(function(){var _z5 = E(_yU);var _z6 = _z5[1];var _z7 = E(_z6);return _z7;});var _z8 = T(function(){var _z9 = E(_z4);var _za = _z9[1];var _zb = _za>0;if(_zb){var _zc = E(_yU);var _zd = _zc[2];var _ze = E(_zd);if(_ze[0]==1){var _zf = E(_uN);}else{var _zg = _ze[1];var _zh = _ze[2];var _zi = _uE(_zg,_zh);var _zj = _61(_8Z,_zi);if(_zj[0]==1){var _zk = E(_u9);}else{var _zl = _zj[1];var _zm = _zj[2];var _zk = [1,_zl,_zm];}var _zf = _zk;}var _zn = _zf;}else{var _zo = E(_yU);var _zp = _zo[2];var _zq = _61(_8Z,_zp);if(_zq[0]==1){var _zr = E(_u9);}else{var _zs = _zq[1];var _zt = _zq[2];var _zr = [1,_zs,_zt];}var _zn = _zr;}return _zn;});var _zu = T(function(){var _zv = E(_z8);var _zw = _zv[2];var _zx = T(function(){var _zy = E(_yk);var _zz = _zy[1];var _zA = E(_z4);var _zB = _zA[1];var _zC = _zz-1|0;var _zD = _zC+_zB|0;var _zE = _8m(_zD,_U);return _zE;});var _zF = [2,_ua,_zx];var _zG = _15(_zw,_zF);return _zG;});var _zH = E(_yj);if(_zH[0]==1){var _zI = [2,_rq,_zu];var _zJ = T(function(){var _zK = E(_z8);var _zL = _zK[1];var _zM = E(_zL);return _zM;});var _zN = [2,_zJ,_zI];}else{var _zO = _zH[1];var _zP = _zH[2];var _zQ = E(_zO);var _zR = _zQ[1];var _zS = E(_zR);if(_zS){var _zT = [2,_rq,_zu];var _zU = T(function(){var _zV = E(_z8);var _zW = _zV[1];var _zX = E(_zW);return _zX;});var _zY = [2,_zU,_zT];}else{var _zZ = E(_zP);if(_zZ[0]==1){var _A0 = T(function(){var _A1 = E(_yP);var _A2 = _A1[1];var _A3 = _A2<=0;var _A4 = _A3?E(_tT):_tU(_uf,_A2);return _A4;});var _A5 = [2,_rq,_A0];var _A6 = [2,_rr,_A5];}else{var _A7 = [2,_rq,_zu];var _A8 = T(function(){var _A9 = E(_z8);var _Aa = _A9[1];var _Ab = E(_Aa);return _Ab;});var _A6 = [2,_A8,_A7];}var _zY = _A6;}var _zN = _zY;}var _yN = _zN;}var _Ac = _yN;break;case 2:var _Ad = E(_uQ);if(_Ad[0]==1){var _Ae = E(_yk);var _Af = _Ae[1];var _Ag = _Af<=0;if(_Ag){var _Ah = T(function(){var _Ai = -_Af;var _Aj = _Ai<=0;if(_Aj){var _Ak = _61(_8Z,_yj);}else{var _Al = T(function(){return _61(_8Z,_yj);});var _Am = [2,_rr,_Al];var _An = function(_Ao){var _Ap = _Ao<=1;if(_Ap){var _Aq = E(_Am);}else{var _Ar = T(function(){var _As = _Ao-1|0;var _At = _An(_As);return _At;});var _Aq = [2,_rr,_Ar];}return _Aq;};var _Ak = _An(_Ai);}return _Ak;});var _Au = unAppCStr("0.",_Ah);}else{var _Av = T(function(){return _61(_8Z,_yj);});var _Au = _rF(_Af,_U,_Av);}var _Aw = _Au;}else{var _Ax = _Ad[1];var _Ay = E(_yk);var _Az = _Ay[1];var _AA = _Az>=0;if(_AA){var _AB = T(function(){var _AC = E(_Ax);var _AD = _AC[1];var _AE = _AD<=0;if(_AE){var _AF = E(_Ay);}else{var _AG = _AD+_Az|0;var _AH = [1,_AG];var _AF = _AH;}return _AF;});var _AI = _sA(_tS,_AB,_yj);var _AJ = _AI[1];var _AK = _AI[2];var _AL = E(_AJ);var _AM = _AL[1];var _AN = _Az+_AM|0;var _AO = _AN<0;if(_AO){var _AP = T(function(){var _AQ = _61(_8Z,_AK);return _AQ[0]==1?[1]:[2,_rq,_AQ];});var _AR = [2,_rr,_AP];}else{var _AS = T(function(){return _61(_8Z,_AK);});var _AT = _ug(_AN,_AS);var _AU = _AT[1];var _AV = _AT[2];var _AW = E(_AU);if(_AW[0]==1){var _AX = T(function(){var _AY = E(_AV);return _AY[0]==1?[1]:[2,_rq,_AY];});var _AZ = [2,_rr,_AX];}else{var _B0 = T(function(){var _B1 = E(_AV);return _B1[0]==1?[1]:[2,_rq,_B1];});var _AZ = _15(_AW,_B0);}var _AR = _AZ;}var _B2 = _AR;}else{var _B3 = T(function(){var _B4 = -_Az;var _B5 = _B4<=0;if(_B5){var _B6 = T(function(){var _B7 = E(_Ax);var _B8 = _B7[1];var _B9 = _B8<=0;var _Ba = _B9?E(_84):E(_B7);return _Ba;});var _Bb = _sA(_tS,_B6,_yj);var _Bc = _Bb[1];var _Bd = _Bb[2];var _Be = _95(_Bc,_Bd);var _Bf = _Be;}else{var _Bg = [2,_84,_yj];var _Bh = function(_Bi){var _Bj = _Bi<=1;if(_Bj){var _Bk = E(_Bg);}else{var _Bl = T(function(){var _Bm = _Bi-1|0;var _Bn = _Bh(_Bm);return _Bn;});var _Bk = [2,_84,_Bl];}return _Bk;};var _Bo = _Bh(_B4);var _Bp = T(function(){var _Bq = E(_Ax);var _Br = _Bq[1];var _Bs = _Br<=0;var _Bt = _Bs?E(_84):E(_Bq);return _Bt;});var _Bu = _sA(_tS,_Bp,_Bo);var _Bv = _Bu[1];var _Bw = _Bu[2];var _Bx = _95(_Bv,_Bw);var _Bf = _Bx;}return _Bf;});var _By = T(function(){var _Bz = E(_B3);var _BA = _Bz[2];var _BB = E(_BA);var _BC = _BB[0]==1?[1]:[2,_rq,_BB];return _BC;});var _BD = T(function(){var _BE = E(_B3);var _BF = _BE[1];var _BG = E(_BF);return _BG;});var _B2 = [2,_BD,_By];}var _Aw = _B2;}var _Ac = _Aw;break;case 3:var _BH = E(_yk);var _BI = _BH[1];var _BJ = _BI<0;if(_BJ){var _BK = _v1(_yj,_BI);}else{var _BL = _BI>7;var _BK = _BL?_v1(_yj,_BI):_wO(_yj,_BI);}var _Ac = _BK;break;}return _Ac;};var _BM = T(function(){var _BN = -_uR;var _BO = _od(_ub,_BN);var _BP = _BO[1];var _BQ = _BO[2];var _BR = _yh(_uP,_BP,_BQ);return _BR;});var _BS = _uR<0;if(_BS){var _BT = [2,_60,_BM];}else{var _BU = isDoubleNegativeZero(_uR,realWorld);var _BV = _BU[2];var _BW = E(_BV);if(_BW){var _BX = [2,_60,_BM];}else{var _BY = _od(_ub,_uR);var _BZ = _BY[1];var _C0 = _BY[2];var _C1 = _yh(_uP,_BZ,_C0);var _BX = _C1;}var _BT = _BX;}var _v0 = _BT;}var _uV = _v0;}return _uV;};var _C2 = [3];var _C3 = function(_C4){var _C5 = E(_C4);var _C6 = _C5[1];var _C7 = _C6<0;if(_C7){var _C8 = T(function(){var _C9 = -_C6;var _Ca = _uO(_C2,_3b,_C9);var _Cb = _15(_Ca,_U);return _Cb;});var _Cc = [2,_60,_C8];}else{var _Cd = isDoubleNegativeZero(_C6,realWorld);var _Ce = _Cd[2];var _Cf = E(_Ce);if(_Cf){var _Cg = T(function(){var _Ch = -_C6;var _Ci = _uO(_C2,_3b,_Ch);var _Cj = _15(_Ci,_U);return _Cj;});var _Ck = [2,_60,_Cg];}else{var _Cl = _uO(_C2,_3b,_C6);var _Cm = _15(_Cl,_U);var _Ck = _Cm;}var _Cc = _Ck;}return _Cc;};var _Cn = function(_Co,_Cp){var _Cq = E(_Co);if(_Cq[0]==1){var _Cr = unAppCStr("[]",_Cp);}else{var _Cs = _Cq[1];var _Ct = _Cq[2];var _Cu = T(function(){var _Cv = E(_Cs);var _Cw = _Cv[1];var _Cx = T(function(){var _Cy = [2,_2o,_Cp];var _Cz = function(_CA){var _CB = E(_CA);if(_CB[0]==1){var _CC = E(_Cy);}else{var _CD = _CB[1];var _CE = _CB[2];var _CF = T(function(){var _CG = E(_CD);var _CH = _CG[1];var _CI = _CH<0;if(_CI){var _CJ = T(function(){var _CK = T(function(){return _Cz(_CE);});var _CL = -_CH;var _CM = _uO(_C2,_3b,_CL);var _CN = _15(_CM,_CK);return _CN;});var _CO = [2,_60,_CJ];}else{var _CP = isDoubleNegativeZero(_CH,realWorld);var _CQ = _CP[2];var _CR = E(_CQ);if(_CR){var _CS = T(function(){var _CT = T(function(){return _Cz(_CE);});var _CU = -_CH;var _CV = _uO(_C2,_3b,_CU);var _CW = _15(_CV,_CT);return _CW;});var _CX = [2,_60,_CS];}else{var _CY = T(function(){return _Cz(_CE);});var _CZ = _uO(_C2,_3b,_CH);var _D0 = _15(_CZ,_CY);var _CX = _D0;}var _CO = _CX;}return _CO;});var _CC = [2,_2n,_CF];}return _CC;};return _Cz(_Ct);});var _D1 = _Cw<0;if(_D1){var _D2 = T(function(){var _D3 = -_Cw;var _D4 = _uO(_C2,_3b,_D3);var _D5 = _15(_D4,_Cx);return _D5;});var _D6 = [2,_60,_D2];}else{var _D7 = isDoubleNegativeZero(_Cw,realWorld);var _D8 = _D7[2];var _D9 = E(_D8);if(_D9){var _Da = T(function(){var _Db = -_Cw;var _Dc = _uO(_C2,_3b,_Db);var _Dd = _15(_Dc,_Cx);return _Dd;});var _De = [2,_60,_Da];}else{var _Df = _uO(_C2,_3b,_Cw);var _Dg = _15(_Df,_Cx);var _De = _Dg;}var _D6 = _De;}return _D6;});var _Cr = [2,_2p,_Cu];}return _Cr;};var _Dh = function(_Di){var _Dj = T(function(){var _Dk = E(_Di);var _Dl = _Dk[1];var _Dm = _uO(_C2,_3b,_Dl);return _Dm;});return A(_15,[_Dj]);};var _Dn = function(_Do,_Dp,_Dq){var _Dr = T(function(){var _Ds = -_Dq;var _Dt = [1,_Ds];var _Du = A(_Do,[_Dt]);return _Du;});var _Dv = T(function(){var _Dw = E(_Dp);var _Dx = _Dw[1];var _Dy = _Dx>6;if(_Dy){var _Dz = function(_DA){var _DB = T(function(){var _DC = [2,_aw,_DA];return A(_Dr,[_DC]);});var _DD = [2,_60,_DB];return [2,_aX,_DD];};var _DE = E(_Dz);}else{var _DF = function(_DG){var _DH = T(function(){return A(_Dr,[_DG]);});return [2,_60,_DH];};var _DE = E(_DF);}return _DE;});var _DI = _Dq<0;if(_DI){var _DJ = E(_Dv);}else{var _DK = isDoubleNegativeZero(_Dq,realWorld);var _DL = _DK[2];var _DM = E(_DL);if(_DM){var _DN = E(_Dv);}else{var _DO = [1,_Dq];var _DN = A(_Do,[_DO]);}var _DJ = _DN;}return _DJ;};var _DP = function(_DQ,_DR){var _DS = E(_DR);var _DT = _DS[1];var _DU = _Dn(_Dh,_DQ,_DT);return _DU;};var _DV = [1,_DP,_C3,_Cn];var _DW = function(_DX){var _DY = E(_DX);var _DZ = _DY[2];var _E0 = E(_DZ);return _E0;};var _E1 = T(function(){var _E2 = T(function(){return _DW(_DV);});return A(_41,[toJSStr,_E2]);});var _E3 = T(function(){return _4b(_3n);});var _E4 = T(function(){return A(_41,[_E3,_E1]);});var _E5 = [1];var _E6 = function(_E7,_E8){var _E9 = E(_E7);var _Ea = _E9[1];var _Eb = logDouble(_Ea,_E8);var _Ec = _Eb[1];var _Ed = [1,_Ec,_E5];return _Ed;};var _Ee = function(_Ef,_3X){return _E6(_Ef,_3X);};var _Eg = function(_Eh,_Ei){var _Ej = E(_Eh);var _Ek = _Ej[1];var _El = logString(_Ek,_Ei);var _Em = _El[1];var _En = [1,_Em,_E5];return _En;};var _Eo = function(_Ef,_3X){return _Eg(_Ef,_3X);};var _Ep = function(_Eq){var _Er = T(function(){var _Es = function(_Et){var _Eu = function(_Ev){return _5I(_Eo,_Ev);};var _Ew = T(function(){return _5I(_E4,_Et);});return A(_3o,[_3n,_Ew,_Eu]);};var _Ex = T(function(){var _Ey = T(function(){var _Ez = [1,1];var _EA = function(_EB){return A(_5B,[_5A,_EB,_Ez]);};var _EC = T(function(){return _4b(_3n);});return A(_41,[_EC,_EA]);});return _5I(_Ey,_Eq);});return A(_3o,[_3n,_Ex,_Es]);});var _ED = T(function(){return _5I(_Ee,_Eq);});return A(_46,[_3n,_ED,_Er]);};var _EE = T(function(){return A(_3o,[_3n,_40,_Ep]);});
window.onload = function() {E(E(_EE)(0));};
