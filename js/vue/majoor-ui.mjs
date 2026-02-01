/**
* @vue/shared v3.5.27
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
// @__NO_SIDE_EFFECTS__
function qe(e) {
  const t = /* @__PURE__ */ Object.create(null);
  for (const n of e.split(",")) t[n] = 1;
  return (n) => n in t;
}
const B = process.env.NODE_ENV !== "production" ? Object.freeze({}) : {}, bt = process.env.NODE_ENV !== "production" ? Object.freeze([]) : [], X = () => {
}, ws = () => !1, Yt = (e) => e.charCodeAt(0) === 111 && e.charCodeAt(1) === 110 && // uppercase letter
(e.charCodeAt(2) > 122 || e.charCodeAt(2) < 97), _n = (e) => e.startsWith("onUpdate:"), J = Object.assign, mo = (e, t) => {
  const n = e.indexOf(t);
  n > -1 && e.splice(n, 1);
}, Wr = Object.prototype.hasOwnProperty, F = (e, t) => Wr.call(e, t), T = Array.isArray, ut = (e) => Cn(e) === "[object Map]", xs = (e) => Cn(e) === "[object Set]", $ = (e) => typeof e == "function", q = (e) => typeof e == "string", rt = (e) => typeof e == "symbol", k = (e) => e !== null && typeof e == "object", _o = (e) => (k(e) || $(e)) && $(e.then) && $(e.catch), Vs = Object.prototype.toString, Cn = (e) => Vs.call(e), vo = (e) => Cn(e).slice(8, -1), Ss = (e) => Cn(e) === "[object Object]", Eo = (e) => q(e) && e !== "NaN" && e[0] !== "-" && "" + parseInt(e, 10) === e, jt = /* @__PURE__ */ qe(
  // the leading comma is intentional so empty string "" is also included
  ",key,ref,ref_for,ref_key,onVnodeBeforeMount,onVnodeMounted,onVnodeBeforeUpdate,onVnodeUpdated,onVnodeBeforeUnmount,onVnodeUnmounted"
), Br = /* @__PURE__ */ qe(
  "bind,cloak,else-if,else,for,html,if,model,on,once,pre,show,slot,text,memo"
), Tn = (e) => {
  const t = /* @__PURE__ */ Object.create(null);
  return (n) => t[n] || (t[n] = e(n));
}, kr = /-\w/g, ye = Tn(
  (e) => e.replace(kr, (t) => t.slice(1).toUpperCase())
), Kr = /\B([A-Z])/g, ot = Tn(
  (e) => e.replace(Kr, "-$1").toLowerCase()
), $n = Tn((e) => e.charAt(0).toUpperCase() + e.slice(1)), ct = Tn(
  (e) => e ? `on${$n(e)}` : ""
), at = (e, t) => !Object.is(e, t), Tt = (e, ...t) => {
  for (let n = 0; n < e.length; n++)
    e[n](...t);
}, vn = (e, t, n, o = !1) => {
  Object.defineProperty(e, t, {
    configurable: !0,
    enumerable: !1,
    writable: o,
    value: n
  });
}, Gr = (e) => {
  const t = parseFloat(e);
  return isNaN(t) ? e : t;
};
let Wo;
const zt = () => Wo || (Wo = typeof globalThis < "u" ? globalThis : typeof self < "u" ? self : typeof window < "u" ? window : typeof global < "u" ? global : {});
function No(e) {
  if (T(e)) {
    const t = {};
    for (let n = 0; n < e.length; n++) {
      const o = e[n], s = q(o) ? zr(o) : No(o);
      if (s)
        for (const r in s)
          t[r] = s[r];
    }
    return t;
  } else if (q(e) || k(e))
    return e;
}
const qr = /;(?![^(]*\))/g, Jr = /:([^]+)/, Yr = /\/\*[^]*?\*\//g;
function zr(e) {
  const t = {};
  return e.replace(Yr, "").split(qr).forEach((n) => {
    if (n) {
      const o = n.split(Jr);
      o.length > 1 && (t[o[0].trim()] = o[1].trim());
    }
  }), t;
}
function An(e) {
  let t = "";
  if (q(e))
    t = e;
  else if (T(e))
    for (let n = 0; n < e.length; n++) {
      const o = An(e[n]);
      o && (t += o + " ");
    }
  else if (k(e))
    for (const n in e)
      e[n] && (t += n + " ");
  return t.trim();
}
const Xr = "html,body,base,head,link,meta,style,title,address,article,aside,footer,header,hgroup,h1,h2,h3,h4,h5,h6,nav,section,div,dd,dl,dt,figcaption,figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,data,dfn,em,i,kbd,mark,q,rp,rt,ruby,s,samp,small,span,strong,sub,sup,time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,option,output,progress,select,textarea,details,dialog,menu,summary,template,blockquote,iframe,tfoot", Zr = "svg,animate,animateMotion,animateTransform,circle,clipPath,color-profile,defs,desc,discard,ellipse,feBlend,feColorMatrix,feComponentTransfer,feComposite,feConvolveMatrix,feDiffuseLighting,feDisplacementMap,feDistantLight,feDropShadow,feFlood,feFuncA,feFuncB,feFuncG,feFuncR,feGaussianBlur,feImage,feMerge,feMergeNode,feMorphology,feOffset,fePointLight,feSpecularLighting,feSpotLight,feTile,feTurbulence,filter,foreignObject,g,hatch,hatchpath,image,line,linearGradient,marker,mask,mesh,meshgradient,meshpatch,meshrow,metadata,mpath,path,pattern,polygon,polyline,radialGradient,rect,set,solidcolor,stop,switch,symbol,text,textPath,title,tspan,unknown,use,view", Qr = "annotation,annotation-xml,maction,maligngroup,malignmark,math,menclose,merror,mfenced,mfrac,mfraction,mglyph,mi,mlabeledtr,mlongdiv,mmultiscripts,mn,mo,mover,mpadded,mphantom,mprescripts,mroot,mrow,ms,mscarries,mscarry,msgroup,msline,mspace,msqrt,msrow,mstack,mstyle,msub,msubsup,msup,mtable,mtd,mtext,mtr,munder,munderover,none,semantics", ei = /* @__PURE__ */ qe(Xr), ti = /* @__PURE__ */ qe(Zr), ni = /* @__PURE__ */ qe(Qr), oi = "itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly", si = /* @__PURE__ */ qe(oi);
function Cs(e) {
  return !!e || e === "";
}
const Ts = (e) => !!(e && e.__v_isRef === !0), cn = (e) => q(e) ? e : e == null ? "" : T(e) || k(e) && (e.toString === Vs || !$(e.toString)) ? Ts(e) ? cn(e.value) : JSON.stringify(e, $s, 2) : String(e), $s = (e, t) => Ts(t) ? $s(e, t.value) : ut(t) ? {
  [`Map(${t.size})`]: [...t.entries()].reduce(
    (n, [o, s], r) => (n[Bn(o, r) + " =>"] = s, n),
    {}
  )
} : xs(t) ? {
  [`Set(${t.size})`]: [...t.values()].map((n) => Bn(n))
} : rt(t) ? Bn(t) : k(t) && !T(t) && !Ss(t) ? String(t) : t, Bn = (e, t = "") => {
  var n;
  return (
    // Symbol.description in es2019+ so we need to cast here to pass
    // the lib: es2016 check
    rt(e) ? `Symbol(${(n = e.description) != null ? n : t})` : e
  );
};
/**
* @vue/reactivity v3.5.27
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
function De(e, ...t) {
  console.warn(`[Vue warn] ${e}`, ...t);
}
let fe;
class ri {
  constructor(t = !1) {
    this.detached = t, this._active = !0, this._on = 0, this.effects = [], this.cleanups = [], this._isPaused = !1, this.parent = fe, !t && fe && (this.index = (fe.scopes || (fe.scopes = [])).push(
      this
    ) - 1);
  }
  get active() {
    return this._active;
  }
  pause() {
    if (this._active) {
      this._isPaused = !0;
      let t, n;
      if (this.scopes)
        for (t = 0, n = this.scopes.length; t < n; t++)
          this.scopes[t].pause();
      for (t = 0, n = this.effects.length; t < n; t++)
        this.effects[t].pause();
    }
  }
  /**
   * Resumes the effect scope, including all child scopes and effects.
   */
  resume() {
    if (this._active && this._isPaused) {
      this._isPaused = !1;
      let t, n;
      if (this.scopes)
        for (t = 0, n = this.scopes.length; t < n; t++)
          this.scopes[t].resume();
      for (t = 0, n = this.effects.length; t < n; t++)
        this.effects[t].resume();
    }
  }
  run(t) {
    if (this._active) {
      const n = fe;
      try {
        return fe = this, t();
      } finally {
        fe = n;
      }
    } else process.env.NODE_ENV !== "production" && De("cannot run an inactive effect scope.");
  }
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  on() {
    ++this._on === 1 && (this.prevScope = fe, fe = this);
  }
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  off() {
    this._on > 0 && --this._on === 0 && (fe = this.prevScope, this.prevScope = void 0);
  }
  stop(t) {
    if (this._active) {
      this._active = !1;
      let n, o;
      for (n = 0, o = this.effects.length; n < o; n++)
        this.effects[n].stop();
      for (this.effects.length = 0, n = 0, o = this.cleanups.length; n < o; n++)
        this.cleanups[n]();
      if (this.cleanups.length = 0, this.scopes) {
        for (n = 0, o = this.scopes.length; n < o; n++)
          this.scopes[n].stop(!0);
        this.scopes.length = 0;
      }
      if (!this.detached && this.parent && !t) {
        const s = this.parent.scopes.pop();
        s && s !== this && (this.parent.scopes[this.index] = s, s.index = this.index);
      }
      this.parent = void 0;
    }
  }
}
function ii() {
  return fe;
}
let U;
const kn = /* @__PURE__ */ new WeakSet();
class As {
  constructor(t) {
    this.fn = t, this.deps = void 0, this.depsTail = void 0, this.flags = 5, this.next = void 0, this.cleanup = void 0, this.scheduler = void 0, fe && fe.active && fe.effects.push(this);
  }
  pause() {
    this.flags |= 64;
  }
  resume() {
    this.flags & 64 && (this.flags &= -65, kn.has(this) && (kn.delete(this), this.trigger()));
  }
  /**
   * @internal
   */
  notify() {
    this.flags & 2 && !(this.flags & 32) || this.flags & 8 || Ms(this);
  }
  run() {
    if (!(this.flags & 1))
      return this.fn();
    this.flags |= 2, Bo(this), Ps(this);
    const t = U, n = Oe;
    U = this, Oe = !0;
    try {
      return this.fn();
    } finally {
      process.env.NODE_ENV !== "production" && U !== this && De(
        "Active effect was not restored correctly - this is likely a Vue internal bug."
      ), Rs(this), U = t, Oe = n, this.flags &= -3;
    }
  }
  stop() {
    if (this.flags & 1) {
      for (let t = this.deps; t; t = t.nextDep)
        Oo(t);
      this.deps = this.depsTail = void 0, Bo(this), this.onStop && this.onStop(), this.flags &= -2;
    }
  }
  trigger() {
    this.flags & 64 ? kn.add(this) : this.scheduler ? this.scheduler() : this.runIfDirty();
  }
  /**
   * @internal
   */
  runIfDirty() {
    eo(this) && this.run();
  }
  get dirty() {
    return eo(this);
  }
}
let Is = 0, Ft, Ht;
function Ms(e, t = !1) {
  if (e.flags |= 8, t) {
    e.next = Ht, Ht = e;
    return;
  }
  e.next = Ft, Ft = e;
}
function bo() {
  Is++;
}
function yo() {
  if (--Is > 0)
    return;
  if (Ht) {
    let t = Ht;
    for (Ht = void 0; t; ) {
      const n = t.next;
      t.next = void 0, t.flags &= -9, t = n;
    }
  }
  let e;
  for (; Ft; ) {
    let t = Ft;
    for (Ft = void 0; t; ) {
      const n = t.next;
      if (t.next = void 0, t.flags &= -9, t.flags & 1)
        try {
          t.trigger();
        } catch (o) {
          e || (e = o);
        }
      t = n;
    }
  }
  if (e) throw e;
}
function Ps(e) {
  for (let t = e.deps; t; t = t.nextDep)
    t.version = -1, t.prevActiveLink = t.dep.activeLink, t.dep.activeLink = t;
}
function Rs(e) {
  let t, n = e.depsTail, o = n;
  for (; o; ) {
    const s = o.prevDep;
    o.version === -1 ? (o === n && (n = s), Oo(o), li(o)) : t = o, o.dep.activeLink = o.prevActiveLink, o.prevActiveLink = void 0, o = s;
  }
  e.deps = t, e.depsTail = n;
}
function eo(e) {
  for (let t = e.deps; t; t = t.nextDep)
    if (t.dep.version !== t.version || t.dep.computed && (js(t.dep.computed) || t.dep.version !== t.version))
      return !0;
  return !!e._dirty;
}
function js(e) {
  if (e.flags & 4 && !(e.flags & 16) || (e.flags &= -17, e.globalVersion === kt) || (e.globalVersion = kt, !e.isSSR && e.flags & 128 && (!e.deps && !e._dirty || !eo(e))))
    return;
  e.flags |= 2;
  const t = e.dep, n = U, o = Oe;
  U = e, Oe = !0;
  try {
    Ps(e);
    const s = e.fn(e._value);
    (t.version === 0 || at(s, e._value)) && (e.flags |= 128, e._value = s, t.version++);
  } catch (s) {
    throw t.version++, s;
  } finally {
    U = n, Oe = o, Rs(e), e.flags &= -3;
  }
}
function Oo(e, t = !1) {
  const { dep: n, prevSub: o, nextSub: s } = e;
  if (o && (o.nextSub = s, e.prevSub = void 0), s && (s.prevSub = o, e.nextSub = void 0), process.env.NODE_ENV !== "production" && n.subsHead === e && (n.subsHead = s), n.subs === e && (n.subs = o, !o && n.computed)) {
    n.computed.flags &= -5;
    for (let r = n.computed.deps; r; r = r.nextDep)
      Oo(r, !0);
  }
  !t && !--n.sc && n.map && n.map.delete(n.key);
}
function li(e) {
  const { prevDep: t, nextDep: n } = e;
  t && (t.nextDep = n, e.prevDep = void 0), n && (n.prevDep = t, e.nextDep = void 0);
}
let Oe = !0;
const Fs = [];
function we() {
  Fs.push(Oe), Oe = !1;
}
function xe() {
  const e = Fs.pop();
  Oe = e === void 0 ? !0 : e;
}
function Bo(e) {
  const { cleanup: t } = e;
  if (e.cleanup = void 0, t) {
    const n = U;
    U = void 0;
    try {
      t();
    } finally {
      U = n;
    }
  }
}
let kt = 0;
class ci {
  constructor(t, n) {
    this.sub = t, this.dep = n, this.version = n.version, this.nextDep = this.prevDep = this.nextSub = this.prevSub = this.prevActiveLink = void 0;
  }
}
class Hs {
  // TODO isolatedDeclarations "__v_skip"
  constructor(t) {
    this.computed = t, this.version = 0, this.activeLink = void 0, this.subs = void 0, this.map = void 0, this.key = void 0, this.sc = 0, this.__v_skip = !0, process.env.NODE_ENV !== "production" && (this.subsHead = void 0);
  }
  track(t) {
    if (!U || !Oe || U === this.computed)
      return;
    let n = this.activeLink;
    if (n === void 0 || n.sub !== U)
      n = this.activeLink = new ci(U, this), U.deps ? (n.prevDep = U.depsTail, U.depsTail.nextDep = n, U.depsTail = n) : U.deps = U.depsTail = n, Ls(n);
    else if (n.version === -1 && (n.version = this.version, n.nextDep)) {
      const o = n.nextDep;
      o.prevDep = n.prevDep, n.prevDep && (n.prevDep.nextDep = o), n.prevDep = U.depsTail, n.nextDep = void 0, U.depsTail.nextDep = n, U.depsTail = n, U.deps === n && (U.deps = o);
    }
    return process.env.NODE_ENV !== "production" && U.onTrack && U.onTrack(
      J(
        {
          effect: U
        },
        t
      )
    ), n;
  }
  trigger(t) {
    this.version++, kt++, this.notify(t);
  }
  notify(t) {
    bo();
    try {
      if (process.env.NODE_ENV !== "production")
        for (let n = this.subsHead; n; n = n.nextSub)
          n.sub.onTrigger && !(n.sub.flags & 8) && n.sub.onTrigger(
            J(
              {
                effect: n.sub
              },
              t
            )
          );
      for (let n = this.subs; n; n = n.prevSub)
        n.sub.notify() && n.sub.dep.notify();
    } finally {
      yo();
    }
  }
}
function Ls(e) {
  if (e.dep.sc++, e.sub.flags & 4) {
    const t = e.dep.computed;
    if (t && !e.dep.subs) {
      t.flags |= 20;
      for (let o = t.deps; o; o = o.nextDep)
        Ls(o);
    }
    const n = e.dep.subs;
    n !== e && (e.prevSub = n, n && (n.nextSub = e)), process.env.NODE_ENV !== "production" && e.dep.subsHead === void 0 && (e.dep.subsHead = e), e.dep.subs = e;
  }
}
const to = /* @__PURE__ */ new WeakMap(), pt = /* @__PURE__ */ Symbol(
  process.env.NODE_ENV !== "production" ? "Object iterate" : ""
), no = /* @__PURE__ */ Symbol(
  process.env.NODE_ENV !== "production" ? "Map keys iterate" : ""
), Kt = /* @__PURE__ */ Symbol(
  process.env.NODE_ENV !== "production" ? "Array iterate" : ""
);
function z(e, t, n) {
  if (Oe && U) {
    let o = to.get(e);
    o || to.set(e, o = /* @__PURE__ */ new Map());
    let s = o.get(n);
    s || (o.set(n, s = new Hs()), s.map = o, s.key = n), process.env.NODE_ENV !== "production" ? s.track({
      target: e,
      type: t,
      key: n
    }) : s.track();
  }
}
function Me(e, t, n, o, s, r) {
  const i = to.get(e);
  if (!i) {
    kt++;
    return;
  }
  const l = (f) => {
    f && (process.env.NODE_ENV !== "production" ? f.trigger({
      target: e,
      type: t,
      key: n,
      newValue: o,
      oldValue: s,
      oldTarget: r
    }) : f.trigger());
  };
  if (bo(), t === "clear")
    i.forEach(l);
  else {
    const f = T(e), d = f && Eo(n);
    if (f && n === "length") {
      const p = Number(o);
      i.forEach((a, g) => {
        (g === "length" || g === Kt || !rt(g) && g >= p) && l(a);
      });
    } else
      switch ((n !== void 0 || i.has(void 0)) && l(i.get(n)), d && l(i.get(Kt)), t) {
        case "add":
          f ? d && l(i.get("length")) : (l(i.get(pt)), ut(e) && l(i.get(no)));
          break;
        case "delete":
          f || (l(i.get(pt)), ut(e) && l(i.get(no)));
          break;
        case "set":
          ut(e) && l(i.get(pt));
          break;
      }
  }
  yo();
}
function _t(e) {
  const t = /* @__PURE__ */ M(e);
  return t === e ? t : (z(t, "iterate", Kt), /* @__PURE__ */ ue(e) ? t : t.map(Ge));
}
function In(e) {
  return z(e = /* @__PURE__ */ M(e), "iterate", Kt), e;
}
function Ze(e, t) {
  return /* @__PURE__ */ Re(e) ? Dt(/* @__PURE__ */ nt(e) ? Ge(t) : t) : Ge(t);
}
const fi = {
  __proto__: null,
  [Symbol.iterator]() {
    return Kn(this, Symbol.iterator, (e) => Ze(this, e));
  },
  concat(...e) {
    return _t(this).concat(
      ...e.map((t) => T(t) ? _t(t) : t)
    );
  },
  entries() {
    return Kn(this, "entries", (e) => (e[1] = Ze(this, e[1]), e));
  },
  every(e, t) {
    return He(this, "every", e, t, void 0, arguments);
  },
  filter(e, t) {
    return He(
      this,
      "filter",
      e,
      t,
      (n) => n.map((o) => Ze(this, o)),
      arguments
    );
  },
  find(e, t) {
    return He(
      this,
      "find",
      e,
      t,
      (n) => Ze(this, n),
      arguments
    );
  },
  findIndex(e, t) {
    return He(this, "findIndex", e, t, void 0, arguments);
  },
  findLast(e, t) {
    return He(
      this,
      "findLast",
      e,
      t,
      (n) => Ze(this, n),
      arguments
    );
  },
  findLastIndex(e, t) {
    return He(this, "findLastIndex", e, t, void 0, arguments);
  },
  // flat, flatMap could benefit from ARRAY_ITERATE but are not straight-forward to implement
  forEach(e, t) {
    return He(this, "forEach", e, t, void 0, arguments);
  },
  includes(...e) {
    return Gn(this, "includes", e);
  },
  indexOf(...e) {
    return Gn(this, "indexOf", e);
  },
  join(e) {
    return _t(this).join(e);
  },
  // keys() iterator only reads `length`, no optimization required
  lastIndexOf(...e) {
    return Gn(this, "lastIndexOf", e);
  },
  map(e, t) {
    return He(this, "map", e, t, void 0, arguments);
  },
  pop() {
    return $t(this, "pop");
  },
  push(...e) {
    return $t(this, "push", e);
  },
  reduce(e, ...t) {
    return ko(this, "reduce", e, t);
  },
  reduceRight(e, ...t) {
    return ko(this, "reduceRight", e, t);
  },
  shift() {
    return $t(this, "shift");
  },
  // slice could use ARRAY_ITERATE but also seems to beg for range tracking
  some(e, t) {
    return He(this, "some", e, t, void 0, arguments);
  },
  splice(...e) {
    return $t(this, "splice", e);
  },
  toReversed() {
    return _t(this).toReversed();
  },
  toSorted(e) {
    return _t(this).toSorted(e);
  },
  toSpliced(...e) {
    return _t(this).toSpliced(...e);
  },
  unshift(...e) {
    return $t(this, "unshift", e);
  },
  values() {
    return Kn(this, "values", (e) => Ze(this, e));
  }
};
function Kn(e, t, n) {
  const o = In(e), s = o[t]();
  return o !== e && !/* @__PURE__ */ ue(e) && (s._next = s.next, s.next = () => {
    const r = s._next();
    return r.done || (r.value = n(r.value)), r;
  }), s;
}
const ui = Array.prototype;
function He(e, t, n, o, s, r) {
  const i = In(e), l = i !== e && !/* @__PURE__ */ ue(e), f = i[t];
  if (f !== ui[t]) {
    const a = f.apply(e, r);
    return l ? Ge(a) : a;
  }
  let d = n;
  i !== e && (l ? d = function(a, g) {
    return n.call(this, Ze(e, a), g, e);
  } : n.length > 2 && (d = function(a, g) {
    return n.call(this, a, g, e);
  }));
  const p = f.call(i, d, o);
  return l && s ? s(p) : p;
}
function ko(e, t, n, o) {
  const s = In(e);
  let r = n;
  return s !== e && (/* @__PURE__ */ ue(e) ? n.length > 3 && (r = function(i, l, f) {
    return n.call(this, i, l, f, e);
  }) : r = function(i, l, f) {
    return n.call(this, i, Ze(e, l), f, e);
  }), s[t](r, ...o);
}
function Gn(e, t, n) {
  const o = /* @__PURE__ */ M(e);
  z(o, "iterate", Kt);
  const s = o[t](...n);
  return (s === -1 || s === !1) && /* @__PURE__ */ En(n[0]) ? (n[0] = /* @__PURE__ */ M(n[0]), o[t](...n)) : s;
}
function $t(e, t, n = []) {
  we(), bo();
  const o = (/* @__PURE__ */ M(e))[t].apply(e, n);
  return yo(), xe(), o;
}
const ai = /* @__PURE__ */ qe("__proto__,__v_isRef,__isVue"), Us = new Set(
  /* @__PURE__ */ Object.getOwnPropertyNames(Symbol).filter((e) => e !== "arguments" && e !== "caller").map((e) => Symbol[e]).filter(rt)
);
function pi(e) {
  rt(e) || (e = String(e));
  const t = /* @__PURE__ */ M(this);
  return z(t, "has", e), t.hasOwnProperty(e);
}
class Ws {
  constructor(t = !1, n = !1) {
    this._isReadonly = t, this._isShallow = n;
  }
  get(t, n, o) {
    if (n === "__v_skip") return t.__v_skip;
    const s = this._isReadonly, r = this._isShallow;
    if (n === "__v_isReactive")
      return !s;
    if (n === "__v_isReadonly")
      return s;
    if (n === "__v_isShallow")
      return r;
    if (n === "__v_raw")
      return o === (s ? r ? Js : qs : r ? Gs : Ks).get(t) || // receiver is not the reactive proxy, but has the same prototype
      // this means the receiver is a user proxy of the reactive proxy
      Object.getPrototypeOf(t) === Object.getPrototypeOf(o) ? t : void 0;
    const i = T(t);
    if (!s) {
      let f;
      if (i && (f = fi[n]))
        return f;
      if (n === "hasOwnProperty")
        return pi;
    }
    const l = Reflect.get(
      t,
      n,
      // if this is a proxy wrapping a ref, return methods using the raw ref
      // as receiver so that we don't have to call `toRaw` on the ref in all
      // its class methods
      /* @__PURE__ */ Z(t) ? t : o
    );
    if ((rt(n) ? Us.has(n) : ai(n)) || (s || z(t, "get", n), r))
      return l;
    if (/* @__PURE__ */ Z(l)) {
      const f = i && Eo(n) ? l : l.value;
      return s && k(f) ? /* @__PURE__ */ so(f) : f;
    }
    return k(l) ? s ? /* @__PURE__ */ so(l) : /* @__PURE__ */ Do(l) : l;
  }
}
class Bs extends Ws {
  constructor(t = !1) {
    super(!1, t);
  }
  set(t, n, o, s) {
    let r = t[n];
    const i = T(t) && Eo(n);
    if (!this._isShallow) {
      const d = /* @__PURE__ */ Re(r);
      if (!/* @__PURE__ */ ue(o) && !/* @__PURE__ */ Re(o) && (r = /* @__PURE__ */ M(r), o = /* @__PURE__ */ M(o)), !i && /* @__PURE__ */ Z(r) && !/* @__PURE__ */ Z(o))
        return d ? (process.env.NODE_ENV !== "production" && De(
          `Set operation on key "${String(n)}" failed: target is readonly.`,
          t[n]
        ), !0) : (r.value = o, !0);
    }
    const l = i ? Number(n) < t.length : F(t, n), f = Reflect.set(
      t,
      n,
      o,
      /* @__PURE__ */ Z(t) ? t : s
    );
    return t === /* @__PURE__ */ M(s) && (l ? at(o, r) && Me(t, "set", n, o, r) : Me(t, "add", n, o)), f;
  }
  deleteProperty(t, n) {
    const o = F(t, n), s = t[n], r = Reflect.deleteProperty(t, n);
    return r && o && Me(t, "delete", n, void 0, s), r;
  }
  has(t, n) {
    const o = Reflect.has(t, n);
    return (!rt(n) || !Us.has(n)) && z(t, "has", n), o;
  }
  ownKeys(t) {
    return z(
      t,
      "iterate",
      T(t) ? "length" : pt
    ), Reflect.ownKeys(t);
  }
}
class ks extends Ws {
  constructor(t = !1) {
    super(!0, t);
  }
  set(t, n) {
    return process.env.NODE_ENV !== "production" && De(
      `Set operation on key "${String(n)}" failed: target is readonly.`,
      t
    ), !0;
  }
  deleteProperty(t, n) {
    return process.env.NODE_ENV !== "production" && De(
      `Delete operation on key "${String(n)}" failed: target is readonly.`,
      t
    ), !0;
  }
}
const di = /* @__PURE__ */ new Bs(), hi = /* @__PURE__ */ new ks(), gi = /* @__PURE__ */ new Bs(!0), mi = /* @__PURE__ */ new ks(!0), oo = (e) => e, sn = (e) => Reflect.getPrototypeOf(e);
function _i(e, t, n) {
  return function(...o) {
    const s = this.__v_raw, r = /* @__PURE__ */ M(s), i = ut(r), l = e === "entries" || e === Symbol.iterator && i, f = e === "keys" && i, d = s[e](...o), p = n ? oo : t ? Dt : Ge;
    return !t && z(
      r,
      "iterate",
      f ? no : pt
    ), J(
      // inheriting all iterator properties
      Object.create(d),
      {
        // iterator protocol
        next() {
          const { value: a, done: g } = d.next();
          return g ? { value: a, done: g } : {
            value: l ? [p(a[0]), p(a[1])] : p(a),
            done: g
          };
        }
      }
    );
  };
}
function rn(e) {
  return function(...t) {
    if (process.env.NODE_ENV !== "production") {
      const n = t[0] ? `on key "${t[0]}" ` : "";
      De(
        `${$n(e)} operation ${n}failed: target is readonly.`,
        /* @__PURE__ */ M(this)
      );
    }
    return e === "delete" ? !1 : e === "clear" ? void 0 : this;
  };
}
function vi(e, t) {
  const n = {
    get(s) {
      const r = this.__v_raw, i = /* @__PURE__ */ M(r), l = /* @__PURE__ */ M(s);
      e || (at(s, l) && z(i, "get", s), z(i, "get", l));
      const { has: f } = sn(i), d = t ? oo : e ? Dt : Ge;
      if (f.call(i, s))
        return d(r.get(s));
      if (f.call(i, l))
        return d(r.get(l));
      r !== i && r.get(s);
    },
    get size() {
      const s = this.__v_raw;
      return !e && z(/* @__PURE__ */ M(s), "iterate", pt), s.size;
    },
    has(s) {
      const r = this.__v_raw, i = /* @__PURE__ */ M(r), l = /* @__PURE__ */ M(s);
      return e || (at(s, l) && z(i, "has", s), z(i, "has", l)), s === l ? r.has(s) : r.has(s) || r.has(l);
    },
    forEach(s, r) {
      const i = this, l = i.__v_raw, f = /* @__PURE__ */ M(l), d = t ? oo : e ? Dt : Ge;
      return !e && z(f, "iterate", pt), l.forEach((p, a) => s.call(r, d(p), d(a), i));
    }
  };
  return J(
    n,
    e ? {
      add: rn("add"),
      set: rn("set"),
      delete: rn("delete"),
      clear: rn("clear")
    } : {
      add(s) {
        !t && !/* @__PURE__ */ ue(s) && !/* @__PURE__ */ Re(s) && (s = /* @__PURE__ */ M(s));
        const r = /* @__PURE__ */ M(this);
        return sn(r).has.call(r, s) || (r.add(s), Me(r, "add", s, s)), this;
      },
      set(s, r) {
        !t && !/* @__PURE__ */ ue(r) && !/* @__PURE__ */ Re(r) && (r = /* @__PURE__ */ M(r));
        const i = /* @__PURE__ */ M(this), { has: l, get: f } = sn(i);
        let d = l.call(i, s);
        d ? process.env.NODE_ENV !== "production" && Ko(i, l, s) : (s = /* @__PURE__ */ M(s), d = l.call(i, s));
        const p = f.call(i, s);
        return i.set(s, r), d ? at(r, p) && Me(i, "set", s, r, p) : Me(i, "add", s, r), this;
      },
      delete(s) {
        const r = /* @__PURE__ */ M(this), { has: i, get: l } = sn(r);
        let f = i.call(r, s);
        f ? process.env.NODE_ENV !== "production" && Ko(r, i, s) : (s = /* @__PURE__ */ M(s), f = i.call(r, s));
        const d = l ? l.call(r, s) : void 0, p = r.delete(s);
        return f && Me(r, "delete", s, void 0, d), p;
      },
      clear() {
        const s = /* @__PURE__ */ M(this), r = s.size !== 0, i = process.env.NODE_ENV !== "production" ? ut(s) ? new Map(s) : new Set(s) : void 0, l = s.clear();
        return r && Me(
          s,
          "clear",
          void 0,
          void 0,
          i
        ), l;
      }
    }
  ), [
    "keys",
    "values",
    "entries",
    Symbol.iterator
  ].forEach((s) => {
    n[s] = _i(s, e, t);
  }), n;
}
function Mn(e, t) {
  const n = vi(e, t);
  return (o, s, r) => s === "__v_isReactive" ? !e : s === "__v_isReadonly" ? e : s === "__v_raw" ? o : Reflect.get(
    F(n, s) && s in o ? n : o,
    s,
    r
  );
}
const Ei = {
  get: /* @__PURE__ */ Mn(!1, !1)
}, Ni = {
  get: /* @__PURE__ */ Mn(!1, !0)
}, bi = {
  get: /* @__PURE__ */ Mn(!0, !1)
}, yi = {
  get: /* @__PURE__ */ Mn(!0, !0)
};
function Ko(e, t, n) {
  const o = /* @__PURE__ */ M(n);
  if (o !== n && t.call(e, o)) {
    const s = vo(e);
    De(
      `Reactive ${s} contains both the raw and reactive versions of the same object${s === "Map" ? " as keys" : ""}, which can lead to inconsistencies. Avoid differentiating between the raw and reactive versions of an object and only use the reactive version if possible.`
    );
  }
}
const Ks = /* @__PURE__ */ new WeakMap(), Gs = /* @__PURE__ */ new WeakMap(), qs = /* @__PURE__ */ new WeakMap(), Js = /* @__PURE__ */ new WeakMap();
function Oi(e) {
  switch (e) {
    case "Object":
    case "Array":
      return 1;
    case "Map":
    case "Set":
    case "WeakMap":
    case "WeakSet":
      return 2;
    default:
      return 0;
  }
}
function Di(e) {
  return e.__v_skip || !Object.isExtensible(e) ? 0 : Oi(vo(e));
}
// @__NO_SIDE_EFFECTS__
function Do(e) {
  return /* @__PURE__ */ Re(e) ? e : Pn(
    e,
    !1,
    di,
    Ei,
    Ks
  );
}
// @__NO_SIDE_EFFECTS__
function wi(e) {
  return Pn(
    e,
    !1,
    gi,
    Ni,
    Gs
  );
}
// @__NO_SIDE_EFFECTS__
function so(e) {
  return Pn(
    e,
    !0,
    hi,
    bi,
    qs
  );
}
// @__NO_SIDE_EFFECTS__
function Pe(e) {
  return Pn(
    e,
    !0,
    mi,
    yi,
    Js
  );
}
function Pn(e, t, n, o, s) {
  if (!k(e))
    return process.env.NODE_ENV !== "production" && De(
      `value cannot be made ${t ? "readonly" : "reactive"}: ${String(
        e
      )}`
    ), e;
  if (e.__v_raw && !(t && e.__v_isReactive))
    return e;
  const r = Di(e);
  if (r === 0)
    return e;
  const i = s.get(e);
  if (i)
    return i;
  const l = new Proxy(
    e,
    r === 2 ? o : n
  );
  return s.set(e, l), l;
}
// @__NO_SIDE_EFFECTS__
function nt(e) {
  return /* @__PURE__ */ Re(e) ? /* @__PURE__ */ nt(e.__v_raw) : !!(e && e.__v_isReactive);
}
// @__NO_SIDE_EFFECTS__
function Re(e) {
  return !!(e && e.__v_isReadonly);
}
// @__NO_SIDE_EFFECTS__
function ue(e) {
  return !!(e && e.__v_isShallow);
}
// @__NO_SIDE_EFFECTS__
function En(e) {
  return e ? !!e.__v_raw : !1;
}
// @__NO_SIDE_EFFECTS__
function M(e) {
  const t = e && e.__v_raw;
  return t ? /* @__PURE__ */ M(t) : e;
}
function xi(e) {
  return !F(e, "__v_skip") && Object.isExtensible(e) && vn(e, "__v_skip", !0), e;
}
const Ge = (e) => k(e) ? /* @__PURE__ */ Do(e) : e, Dt = (e) => k(e) ? /* @__PURE__ */ so(e) : e;
// @__NO_SIDE_EFFECTS__
function Z(e) {
  return e ? e.__v_isRef === !0 : !1;
}
function Vi(e) {
  return /* @__PURE__ */ Z(e) ? e.value : e;
}
const Si = {
  get: (e, t, n) => t === "__v_raw" ? e : Vi(Reflect.get(e, t, n)),
  set: (e, t, n, o) => {
    const s = e[t];
    return /* @__PURE__ */ Z(s) && !/* @__PURE__ */ Z(n) ? (s.value = n, !0) : Reflect.set(e, t, n, o);
  }
};
function Ys(e) {
  return /* @__PURE__ */ nt(e) ? e : new Proxy(e, Si);
}
class Ci {
  constructor(t, n, o) {
    this.fn = t, this.setter = n, this._value = void 0, this.dep = new Hs(this), this.__v_isRef = !0, this.deps = void 0, this.depsTail = void 0, this.flags = 16, this.globalVersion = kt - 1, this.next = void 0, this.effect = this, this.__v_isReadonly = !n, this.isSSR = o;
  }
  /**
   * @internal
   */
  notify() {
    if (this.flags |= 16, !(this.flags & 8) && // avoid infinite self recursion
    U !== this)
      return Ms(this, !0), !0;
    process.env.NODE_ENV;
  }
  get value() {
    const t = process.env.NODE_ENV !== "production" ? this.dep.track({
      target: this,
      type: "get",
      key: "value"
    }) : this.dep.track();
    return js(this), t && (t.version = this.dep.version), this._value;
  }
  set value(t) {
    this.setter ? this.setter(t) : process.env.NODE_ENV !== "production" && De("Write operation failed: computed value is readonly");
  }
}
// @__NO_SIDE_EFFECTS__
function Ti(e, t, n = !1) {
  let o, s;
  $(e) ? o = e : (o = e.get, s = e.set);
  const r = new Ci(o, s, n);
  return process.env.NODE_ENV, r;
}
const ln = {}, Nn = /* @__PURE__ */ new WeakMap();
let ft;
function $i(e, t = !1, n = ft) {
  if (n) {
    let o = Nn.get(n);
    o || Nn.set(n, o = []), o.push(e);
  } else process.env.NODE_ENV !== "production" && !t && De(
    "onWatcherCleanup() was called when there was no active watcher to associate with."
  );
}
function Ai(e, t, n = B) {
  const { immediate: o, deep: s, once: r, scheduler: i, augmentJob: l, call: f } = n, d = (S) => {
    (n.onWarn || De)(
      "Invalid watch source: ",
      S,
      "A watch source can only be a getter/effect function, a ref, a reactive object, or an array of these types."
    );
  }, p = (S) => s ? S : /* @__PURE__ */ ue(S) || s === !1 || s === 0 ? tt(S, 1) : tt(S);
  let a, g, w, A, V = !1, Q = !1;
  if (/* @__PURE__ */ Z(e) ? (g = () => e.value, V = /* @__PURE__ */ ue(e)) : /* @__PURE__ */ nt(e) ? (g = () => p(e), V = !0) : T(e) ? (Q = !0, V = e.some((S) => /* @__PURE__ */ nt(S) || /* @__PURE__ */ ue(S)), g = () => e.map((S) => {
    if (/* @__PURE__ */ Z(S))
      return S.value;
    if (/* @__PURE__ */ nt(S))
      return p(S);
    if ($(S))
      return f ? f(S, 2) : S();
    process.env.NODE_ENV !== "production" && d(S);
  })) : $(e) ? t ? g = f ? () => f(e, 2) : e : g = () => {
    if (w) {
      we();
      try {
        w();
      } finally {
        xe();
      }
    }
    const S = ft;
    ft = a;
    try {
      return f ? f(e, 3, [A]) : e(A);
    } finally {
      ft = S;
    }
  } : (g = X, process.env.NODE_ENV !== "production" && d(e)), t && s) {
    const S = g, ee = s === !0 ? 1 / 0 : s;
    g = () => tt(S(), ee);
  }
  const G = ii(), L = () => {
    a.stop(), G && G.active && mo(G.effects, a);
  };
  if (r && t) {
    const S = t;
    t = (...ee) => {
      S(...ee), L();
    };
  }
  let H = Q ? new Array(e.length).fill(ln) : ln;
  const ae = (S) => {
    if (!(!(a.flags & 1) || !a.dirty && !S))
      if (t) {
        const ee = a.run();
        if (s || V || (Q ? ee.some((me, te) => at(me, H[te])) : at(ee, H))) {
          w && w();
          const me = ft;
          ft = a;
          try {
            const te = [
              ee,
              // pass undefined as the old value when it's changed for the first time
              H === ln ? void 0 : Q && H[0] === ln ? [] : H,
              A
            ];
            H = ee, f ? f(t, 3, te) : (
              // @ts-expect-error
              t(...te)
            );
          } finally {
            ft = me;
          }
        }
      } else
        a.run();
  };
  return l && l(ae), a = new As(g), a.scheduler = i ? () => i(ae, !1) : ae, A = (S) => $i(S, !1, a), w = a.onStop = () => {
    const S = Nn.get(a);
    if (S) {
      if (f)
        f(S, 4);
      else
        for (const ee of S) ee();
      Nn.delete(a);
    }
  }, process.env.NODE_ENV !== "production" && (a.onTrack = n.onTrack, a.onTrigger = n.onTrigger), t ? o ? ae(!0) : H = a.run() : i ? i(ae.bind(null, !0), !0) : a.run(), L.pause = a.pause.bind(a), L.resume = a.resume.bind(a), L.stop = L, L;
}
function tt(e, t = 1 / 0, n) {
  if (t <= 0 || !k(e) || e.__v_skip || (n = n || /* @__PURE__ */ new Map(), (n.get(e) || 0) >= t))
    return e;
  if (n.set(e, t), t--, /* @__PURE__ */ Z(e))
    tt(e.value, t, n);
  else if (T(e))
    for (let o = 0; o < e.length; o++)
      tt(e[o], t, n);
  else if (xs(e) || ut(e))
    e.forEach((o) => {
      tt(o, t, n);
    });
  else if (Ss(e)) {
    for (const o in e)
      tt(e[o], t, n);
    for (const o of Object.getOwnPropertySymbols(e))
      Object.prototype.propertyIsEnumerable.call(e, o) && tt(e[o], t, n);
  }
  return e;
}
/**
* @vue/runtime-core v3.5.27
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
const dt = [];
function fn(e) {
  dt.push(e);
}
function un() {
  dt.pop();
}
let qn = !1;
function y(e, ...t) {
  if (qn) return;
  qn = !0, we();
  const n = dt.length ? dt[dt.length - 1].component : null, o = n && n.appContext.config.warnHandler, s = Ii();
  if (o)
    wt(
      o,
      n,
      11,
      [
        // eslint-disable-next-line no-restricted-syntax
        e + t.map((r) => {
          var i, l;
          return (l = (i = r.toString) == null ? void 0 : i.call(r)) != null ? l : JSON.stringify(r);
        }).join(""),
        n && n.proxy,
        s.map(
          ({ vnode: r }) => `at <${tn(n, r.type)}>`
        ).join(`
`),
        s
      ]
    );
  else {
    const r = [`[Vue warn]: ${e}`, ...t];
    s.length && r.push(`
`, ...Mi(s)), console.warn(...r);
  }
  xe(), qn = !1;
}
function Ii() {
  let e = dt[dt.length - 1];
  if (!e)
    return [];
  const t = [];
  for (; e; ) {
    const n = t[0];
    n && n.vnode === e ? n.recurseCount++ : t.push({
      vnode: e,
      recurseCount: 0
    });
    const o = e.component && e.component.parent;
    e = o && o.vnode;
  }
  return t;
}
function Mi(e) {
  const t = [];
  return e.forEach((n, o) => {
    t.push(...o === 0 ? [] : [`
`], ...Pi(n));
  }), t;
}
function Pi({ vnode: e, recurseCount: t }) {
  const n = t > 0 ? `... (${t} recursive calls)` : "", o = e.component ? e.component.parent == null : !1, s = ` at <${tn(
    e.component,
    e.type,
    o
  )}`, r = ">" + n;
  return e.props ? [s, ...Ri(e.props), r] : [s + r];
}
function Ri(e) {
  const t = [], n = Object.keys(e);
  return n.slice(0, 3).forEach((o) => {
    t.push(...zs(o, e[o]));
  }), n.length > 3 && t.push(" ..."), t;
}
function zs(e, t, n) {
  return q(t) ? (t = JSON.stringify(t), n ? t : [`${e}=${t}`]) : typeof t == "number" || typeof t == "boolean" || t == null ? n ? t : [`${e}=${t}`] : /* @__PURE__ */ Z(t) ? (t = zs(e, /* @__PURE__ */ M(t.value), !0), n ? t : [`${e}=Ref<`, t, ">"]) : $(t) ? [`${e}=fn${t.name ? `<${t.name}>` : ""}`] : (t = /* @__PURE__ */ M(t), n ? t : [`${e}=`, t]);
}
const wo = {
  sp: "serverPrefetch hook",
  bc: "beforeCreate hook",
  c: "created hook",
  bm: "beforeMount hook",
  m: "mounted hook",
  bu: "beforeUpdate hook",
  u: "updated",
  bum: "beforeUnmount hook",
  um: "unmounted hook",
  a: "activated hook",
  da: "deactivated hook",
  ec: "errorCaptured hook",
  rtc: "renderTracked hook",
  rtg: "renderTriggered hook",
  0: "setup function",
  1: "render function",
  2: "watcher getter",
  3: "watcher callback",
  4: "watcher cleanup function",
  5: "native event handler",
  6: "component event handler",
  7: "vnode hook",
  8: "directive hook",
  9: "transition hook",
  10: "app errorHandler",
  11: "app warnHandler",
  12: "ref function",
  13: "async component loader",
  14: "scheduler flush",
  15: "component update",
  16: "app unmount cleanup function"
};
function wt(e, t, n, o) {
  try {
    return o ? e(...o) : e();
  } catch (s) {
    Xt(s, t, n);
  }
}
function je(e, t, n, o) {
  if ($(e)) {
    const s = wt(e, t, n, o);
    return s && _o(s) && s.catch((r) => {
      Xt(r, t, n);
    }), s;
  }
  if (T(e)) {
    const s = [];
    for (let r = 0; r < e.length; r++)
      s.push(je(e[r], t, n, o));
    return s;
  } else process.env.NODE_ENV !== "production" && y(
    `Invalid value type passed to callWithAsyncErrorHandling(): ${typeof e}`
  );
}
function Xt(e, t, n, o = !0) {
  const s = t ? t.vnode : null, { errorHandler: r, throwUnhandledErrorInProduction: i } = t && t.appContext.config || B;
  if (t) {
    let l = t.parent;
    const f = t.proxy, d = process.env.NODE_ENV !== "production" ? wo[n] : `https://vuejs.org/error-reference/#runtime-${n}`;
    for (; l; ) {
      const p = l.ec;
      if (p) {
        for (let a = 0; a < p.length; a++)
          if (p[a](e, f, d) === !1)
            return;
      }
      l = l.parent;
    }
    if (r) {
      we(), wt(r, null, 10, [
        e,
        f,
        d
      ]), xe();
      return;
    }
  }
  ji(e, n, s, o, i);
}
function ji(e, t, n, o = !0, s = !1) {
  if (process.env.NODE_ENV !== "production") {
    const r = wo[t];
    if (n && fn(n), y(`Unhandled error${r ? ` during execution of ${r}` : ""}`), n && un(), o)
      throw e;
    console.error(e);
  } else {
    if (s)
      throw e;
    console.error(e);
  }
}
const se = [];
let Ie = -1;
const yt = [];
let Qe = null, Nt = 0;
const Xs = /* @__PURE__ */ Promise.resolve();
let bn = null;
const Fi = 100;
function Hi(e) {
  const t = bn || Xs;
  return e ? t.then(this ? e.bind(this) : e) : t;
}
function Li(e) {
  let t = Ie + 1, n = se.length;
  for (; t < n; ) {
    const o = t + n >>> 1, s = se[o], r = Gt(s);
    r < e || r === e && s.flags & 2 ? t = o + 1 : n = o;
  }
  return t;
}
function Rn(e) {
  if (!(e.flags & 1)) {
    const t = Gt(e), n = se[se.length - 1];
    !n || // fast path when the job id is larger than the tail
    !(e.flags & 2) && t >= Gt(n) ? se.push(e) : se.splice(Li(t), 0, e), e.flags |= 1, Zs();
  }
}
function Zs() {
  bn || (bn = Xs.then(tr));
}
function Qs(e) {
  T(e) ? yt.push(...e) : Qe && e.id === -1 ? Qe.splice(Nt + 1, 0, e) : e.flags & 1 || (yt.push(e), e.flags |= 1), Zs();
}
function Go(e, t, n = Ie + 1) {
  for (process.env.NODE_ENV !== "production" && (t = t || /* @__PURE__ */ new Map()); n < se.length; n++) {
    const o = se[n];
    if (o && o.flags & 2) {
      if (e && o.id !== e.uid || process.env.NODE_ENV !== "production" && xo(t, o))
        continue;
      se.splice(n, 1), n--, o.flags & 4 && (o.flags &= -2), o(), o.flags & 4 || (o.flags &= -2);
    }
  }
}
function er(e) {
  if (yt.length) {
    const t = [...new Set(yt)].sort(
      (n, o) => Gt(n) - Gt(o)
    );
    if (yt.length = 0, Qe) {
      Qe.push(...t);
      return;
    }
    for (Qe = t, process.env.NODE_ENV !== "production" && (e = e || /* @__PURE__ */ new Map()), Nt = 0; Nt < Qe.length; Nt++) {
      const n = Qe[Nt];
      process.env.NODE_ENV !== "production" && xo(e, n) || (n.flags & 4 && (n.flags &= -2), n.flags & 8 || n(), n.flags &= -2);
    }
    Qe = null, Nt = 0;
  }
}
const Gt = (e) => e.id == null ? e.flags & 2 ? -1 : 1 / 0 : e.id;
function tr(e) {
  process.env.NODE_ENV !== "production" && (e = e || /* @__PURE__ */ new Map());
  const t = process.env.NODE_ENV !== "production" ? (n) => xo(e, n) : X;
  try {
    for (Ie = 0; Ie < se.length; Ie++) {
      const n = se[Ie];
      if (n && !(n.flags & 8)) {
        if (process.env.NODE_ENV !== "production" && t(n))
          continue;
        n.flags & 4 && (n.flags &= -2), wt(
          n,
          n.i,
          n.i ? 15 : 14
        ), n.flags & 4 || (n.flags &= -2);
      }
    }
  } finally {
    for (; Ie < se.length; Ie++) {
      const n = se[Ie];
      n && (n.flags &= -2);
    }
    Ie = -1, se.length = 0, er(e), bn = null, (se.length || yt.length) && tr(e);
  }
}
function xo(e, t) {
  const n = e.get(t) || 0;
  if (n > Fi) {
    const o = t.i, s = o && jr(o.type);
    return Xt(
      `Maximum recursive updates exceeded${s ? ` in component <${s}>` : ""}. This means you have a reactive effect that is mutating its own dependencies and thus recursively triggering itself. Possible sources include component template, render function, updated hook or watcher source function.`,
      null,
      10
    ), !0;
  }
  return e.set(t, n + 1), !1;
}
let Ne = !1;
const an = /* @__PURE__ */ new Map();
process.env.NODE_ENV !== "production" && (zt().__VUE_HMR_RUNTIME__ = {
  createRecord: Jn(nr),
  rerender: Jn(Bi),
  reload: Jn(ki)
});
const gt = /* @__PURE__ */ new Map();
function Ui(e) {
  const t = e.type.__hmrId;
  let n = gt.get(t);
  n || (nr(t, e.type), n = gt.get(t)), n.instances.add(e);
}
function Wi(e) {
  gt.get(e.type.__hmrId).instances.delete(e);
}
function nr(e, t) {
  return gt.has(e) ? !1 : (gt.set(e, {
    initialDef: yn(t),
    instances: /* @__PURE__ */ new Set()
  }), !0);
}
function yn(e) {
  return Fr(e) ? e.__vccOpts : e;
}
function Bi(e, t) {
  const n = gt.get(e);
  n && (n.initialDef.render = t, [...n.instances].forEach((o) => {
    t && (o.render = t, yn(o.type).render = t), o.renderCache = [], Ne = !0, o.job.flags & 8 || o.update(), Ne = !1;
  }));
}
function ki(e, t) {
  const n = gt.get(e);
  if (!n) return;
  t = yn(t), qo(n.initialDef, t);
  const o = [...n.instances];
  for (let s = 0; s < o.length; s++) {
    const r = o[s], i = yn(r.type);
    let l = an.get(i);
    l || (i !== n.initialDef && qo(i, t), an.set(i, l = /* @__PURE__ */ new Set())), l.add(r), r.appContext.propsCache.delete(r.type), r.appContext.emitsCache.delete(r.type), r.appContext.optionsCache.delete(r.type), r.ceReload ? (l.add(r), r.ceReload(t.styles), l.delete(r)) : r.parent ? Rn(() => {
      r.job.flags & 8 || (Ne = !0, r.parent.update(), Ne = !1, l.delete(r));
    }) : r.appContext.reload ? r.appContext.reload() : typeof window < "u" ? window.location.reload() : console.warn(
      "[HMR] Root or manually mounted instance modified. Full reload required."
    ), r.root.ce && r !== r.root && r.root.ce._removeChildStyle(i);
  }
  Qs(() => {
    an.clear();
  });
}
function qo(e, t) {
  J(e, t);
  for (const n in e)
    n !== "__file" && !(n in t) && delete e[n];
}
function Jn(e) {
  return (t, n) => {
    try {
      return e(t, n);
    } catch (o) {
      console.error(o), console.warn(
        "[HMR] Something went wrong during Vue component hot-reload. Full reload required."
      );
    }
  };
}
let be, Pt = [], ro = !1;
function Zt(e, ...t) {
  be ? be.emit(e, ...t) : ro || Pt.push({ event: e, args: t });
}
function Vo(e, t) {
  var n, o;
  be = e, be ? (be.enabled = !0, Pt.forEach(({ event: s, args: r }) => be.emit(s, ...r)), Pt = []) : /* handle late devtools injection - only do this if we are in an actual */ /* browser environment to avoid the timer handle stalling test runner exit */ /* (#4815) */ typeof window < "u" && // some envs mock window but not fully
  window.HTMLElement && // also exclude jsdom
  // eslint-disable-next-line no-restricted-syntax
  !((o = (n = window.navigator) == null ? void 0 : n.userAgent) != null && o.includes("jsdom")) ? ((t.__VUE_DEVTOOLS_HOOK_REPLAY__ = t.__VUE_DEVTOOLS_HOOK_REPLAY__ || []).push((r) => {
    Vo(r, t);
  }), setTimeout(() => {
    be || (t.__VUE_DEVTOOLS_HOOK_REPLAY__ = null, ro = !0, Pt = []);
  }, 3e3)) : (ro = !0, Pt = []);
}
function Ki(e, t) {
  Zt("app:init", e, t, {
    Fragment: _e,
    Text: Qt,
    Comment: ge,
    Static: hn
  });
}
function Gi(e) {
  Zt("app:unmount", e);
}
const qi = /* @__PURE__ */ So(
  "component:added"
  /* COMPONENT_ADDED */
), or = /* @__PURE__ */ So(
  "component:updated"
  /* COMPONENT_UPDATED */
), Ji = /* @__PURE__ */ So(
  "component:removed"
  /* COMPONENT_REMOVED */
), Yi = (e) => {
  be && typeof be.cleanupBuffer == "function" && // remove the component if it wasn't buffered
  !be.cleanupBuffer(e) && Ji(e);
};
// @__NO_SIDE_EFFECTS__
function So(e) {
  return (t) => {
    Zt(
      e,
      t.appContext.app,
      t.uid,
      t.parent ? t.parent.uid : void 0,
      t
    );
  };
}
const zi = /* @__PURE__ */ sr(
  "perf:start"
  /* PERFORMANCE_START */
), Xi = /* @__PURE__ */ sr(
  "perf:end"
  /* PERFORMANCE_END */
);
function sr(e) {
  return (t, n, o) => {
    Zt(e, t.appContext.app, t.uid, t, n, o);
  };
}
function Zi(e, t, n) {
  Zt(
    "component:emit",
    e.appContext.app,
    e,
    t,
    n
  );
}
let de = null, rr = null;
function On(e) {
  const t = de;
  return de = e, rr = e && e.type.__scopeId || null, t;
}
function Qi(e, t = de, n) {
  if (!t || e._n)
    return e;
  const o = (...s) => {
    o._d && ls(-1);
    const r = On(t);
    let i;
    try {
      i = e(...s);
    } finally {
      On(r), o._d && ls(1);
    }
    return process.env.NODE_ENV !== "production" && or(t), i;
  };
  return o._n = !0, o._c = !0, o._d = !0, o;
}
function ir(e) {
  Br(e) && y("Do not use built-in directive ids as custom directive id: " + e);
}
function it(e, t, n, o) {
  const s = e.dirs, r = t && t.dirs;
  for (let i = 0; i < s.length; i++) {
    const l = s[i];
    r && (l.oldValue = r[i].value);
    let f = l.dir[o];
    f && (we(), je(f, n, 8, [
      e.el,
      l,
      e,
      t
    ]), xe());
  }
}
function el(e, t) {
  if (process.env.NODE_ENV !== "production" && (!Y || Y.isMounted) && y("provide() can only be used inside setup()."), Y) {
    let n = Y.provides;
    const o = Y.parent && Y.parent.provides;
    o === n && (n = Y.provides = Object.create(o)), n[e] = t;
  }
}
function pn(e, t, n = !1) {
  const o = Mr();
  if (o || Ot) {
    let s = Ot ? Ot._context.provides : o ? o.parent == null || o.ce ? o.vnode.appContext && o.vnode.appContext.provides : o.parent.provides : void 0;
    if (s && e in s)
      return s[e];
    if (arguments.length > 1)
      return n && $(t) ? t.call(o && o.proxy) : t;
    process.env.NODE_ENV !== "production" && y(`injection "${String(e)}" not found.`);
  } else process.env.NODE_ENV !== "production" && y("inject() can only be used inside setup() or functional components.");
}
const tl = /* @__PURE__ */ Symbol.for("v-scx"), nl = () => {
  {
    const e = pn(tl);
    return e || process.env.NODE_ENV !== "production" && y(
      "Server rendering context not provided. Make sure to only call useSSRContext() conditionally in the server build."
    ), e;
  }
};
function Yn(e, t, n) {
  return process.env.NODE_ENV !== "production" && !$(t) && y(
    "`watch(fn, options?)` signature has been moved to a separate API. Use `watchEffect(fn, options?)` instead. `watch` now only supports `watch(source, cb, options?) signature."
  ), lr(e, t, n);
}
function lr(e, t, n = B) {
  const { immediate: o, deep: s, flush: r, once: i } = n;
  process.env.NODE_ENV !== "production" && !t && (o !== void 0 && y(
    'watch() "immediate" option is only respected when using the watch(source, callback, options?) signature.'
  ), s !== void 0 && y(
    'watch() "deep" option is only respected when using the watch(source, callback, options?) signature.'
  ), i !== void 0 && y(
    'watch() "once" option is only respected when using the watch(source, callback, options?) signature.'
  ));
  const l = J({}, n);
  process.env.NODE_ENV !== "production" && (l.onWarn = y);
  const f = t && o || !t && r !== "post";
  let d;
  if (Jt) {
    if (r === "sync") {
      const w = nl();
      d = w.__watcherHandles || (w.__watcherHandles = []);
    } else if (!f) {
      const w = () => {
      };
      return w.stop = X, w.resume = X, w.pause = X, w;
    }
  }
  const p = Y;
  l.call = (w, A, V) => je(w, p, A, V);
  let a = !1;
  r === "post" ? l.scheduler = (w) => {
    pe(w, p && p.suspense);
  } : r !== "sync" && (a = !0, l.scheduler = (w, A) => {
    A ? w() : Rn(w);
  }), l.augmentJob = (w) => {
    t && (w.flags |= 4), a && (w.flags |= 2, p && (w.id = p.uid, w.i = p));
  };
  const g = Ai(e, t, l);
  return Jt && (d ? d.push(g) : f && g()), g;
}
function ol(e, t, n) {
  const o = this.proxy, s = q(e) ? e.includes(".") ? cr(o, e) : () => o[e] : e.bind(o, o);
  let r;
  $(t) ? r = t : (r = t.handler, n = t);
  const i = en(this), l = lr(s, r.bind(o), n);
  return i(), l;
}
function cr(e, t) {
  const n = t.split(".");
  return () => {
    let o = e;
    for (let s = 0; s < n.length && o; s++)
      o = o[n[s]];
    return o;
  };
}
const sl = /* @__PURE__ */ Symbol("_vte"), rl = (e) => e.__isTeleport, il = /* @__PURE__ */ Symbol("_leaveCb");
function Co(e, t) {
  e.shapeFlag & 6 && e.component ? (e.transition = t, Co(e.component.subTree, t)) : e.shapeFlag & 128 ? (e.ssContent.transition = t.clone(e.ssContent), e.ssFallback.transition = t.clone(e.ssFallback)) : e.transition = t;
}
// @__NO_SIDE_EFFECTS__
function ll(e, t) {
  return $(e) ? (
    // #8236: extend call and options.name access are considered side-effects
    // by Rollup, so we have to wrap it in a pure-annotated IIFE.
    J({ name: e.name }, t, { setup: e })
  ) : e;
}
function fr(e) {
  e.ids = [e.ids[0] + e.ids[2]++ + "-", 0, 0];
}
const Jo = /* @__PURE__ */ new WeakSet(), Dn = /* @__PURE__ */ new WeakMap();
function Lt(e, t, n, o, s = !1) {
  if (T(e)) {
    e.forEach(
      (V, Q) => Lt(
        V,
        t && (T(t) ? t[Q] : t),
        n,
        o,
        s
      )
    );
    return;
  }
  if (Ut(o) && !s) {
    o.shapeFlag & 512 && o.type.__asyncResolved && o.component.subTree.component && Lt(e, t, n, o.component.subTree);
    return;
  }
  const r = o.shapeFlag & 4 ? Ro(o.component) : o.el, i = s ? null : r, { i: l, r: f } = e;
  if (process.env.NODE_ENV !== "production" && !l) {
    y(
      "Missing ref owner context. ref cannot be used on hoisted vnodes. A vnode with ref must be created inside the render function."
    );
    return;
  }
  const d = t && t.r, p = l.refs === B ? l.refs = {} : l.refs, a = l.setupState, g = /* @__PURE__ */ M(a), w = a === B ? ws : (V) => process.env.NODE_ENV !== "production" && (F(g, V) && !/* @__PURE__ */ Z(g[V]) && y(
    `Template ref "${V}" used on a non-ref value. It will not work in the production build.`
  ), Jo.has(g[V])) ? !1 : F(g, V), A = (V) => process.env.NODE_ENV === "production" || !Jo.has(V);
  if (d != null && d !== f) {
    if (Yo(t), q(d))
      p[d] = null, w(d) && (a[d] = null);
    else if (/* @__PURE__ */ Z(d)) {
      A(d) && (d.value = null);
      const V = t;
      V.k && (p[V.k] = null);
    }
  }
  if ($(f))
    wt(f, l, 12, [i, p]);
  else {
    const V = q(f), Q = /* @__PURE__ */ Z(f);
    if (V || Q) {
      const G = () => {
        if (e.f) {
          const L = V ? w(f) ? a[f] : p[f] : A(f) || !e.k ? f.value : p[e.k];
          if (s)
            T(L) && mo(L, r);
          else if (T(L))
            L.includes(r) || L.push(r);
          else if (V)
            p[f] = [r], w(f) && (a[f] = p[f]);
          else {
            const H = [r];
            A(f) && (f.value = H), e.k && (p[e.k] = H);
          }
        } else V ? (p[f] = i, w(f) && (a[f] = i)) : Q ? (A(f) && (f.value = i), e.k && (p[e.k] = i)) : process.env.NODE_ENV !== "production" && y("Invalid template ref type:", f, `(${typeof f})`);
      };
      if (i) {
        const L = () => {
          G(), Dn.delete(e);
        };
        L.id = -1, Dn.set(e, L), pe(L, n);
      } else
        Yo(e), G();
    } else process.env.NODE_ENV !== "production" && y("Invalid template ref type:", f, `(${typeof f})`);
  }
}
function Yo(e) {
  const t = Dn.get(e);
  t && (t.flags |= 8, Dn.delete(e));
}
zt().requestIdleCallback;
zt().cancelIdleCallback;
const Ut = (e) => !!e.type.__asyncLoader, To = (e) => e.type.__isKeepAlive;
function cl(e, t) {
  ur(e, "a", t);
}
function fl(e, t) {
  ur(e, "da", t);
}
function ur(e, t, n = Y) {
  const o = e.__wdc || (e.__wdc = () => {
    let s = n;
    for (; s; ) {
      if (s.isDeactivated)
        return;
      s = s.parent;
    }
    return e();
  });
  if (jn(t, o, n), n) {
    let s = n.parent;
    for (; s && s.parent; )
      To(s.parent.vnode) && ul(o, t, n, s), s = s.parent;
  }
}
function ul(e, t, n, o) {
  const s = jn(
    t,
    e,
    o,
    !0
    /* prepend */
  );
  ar(() => {
    mo(o[t], s);
  }, n);
}
function jn(e, t, n = Y, o = !1) {
  if (n) {
    const s = n[e] || (n[e] = []), r = t.__weh || (t.__weh = (...i) => {
      we();
      const l = en(n), f = je(t, n, e, i);
      return l(), xe(), f;
    });
    return o ? s.unshift(r) : s.push(r), r;
  } else if (process.env.NODE_ENV !== "production") {
    const s = ct(wo[e].replace(/ hook$/, ""));
    y(
      `${s} is called when there is no active component instance to be associated with. Lifecycle injection APIs can only be used during execution of setup(). If you are using async setup(), make sure to register lifecycle hooks before the first await statement.`
    );
  }
}
const Je = (e) => (t, n = Y) => {
  (!Jt || e === "sp") && jn(e, (...o) => t(...o), n);
}, al = Je("bm"), pl = Je("m"), dl = Je(
  "bu"
), hl = Je("u"), gl = Je(
  "bum"
), ar = Je("um"), ml = Je(
  "sp"
), _l = Je("rtg"), vl = Je("rtc");
function El(e, t = Y) {
  jn("ec", e, t);
}
const Nl = /* @__PURE__ */ Symbol.for("v-ndc");
function bl(e, t, n, o) {
  let s;
  const r = n, i = T(e);
  if (i || q(e)) {
    const l = i && /* @__PURE__ */ nt(e);
    let f = !1, d = !1;
    l && (f = !/* @__PURE__ */ ue(e), d = /* @__PURE__ */ Re(e), e = In(e)), s = new Array(e.length);
    for (let p = 0, a = e.length; p < a; p++)
      s[p] = t(
        f ? d ? Dt(Ge(e[p])) : Ge(e[p]) : e[p],
        p,
        void 0,
        r
      );
  } else if (typeof e == "number") {
    process.env.NODE_ENV !== "production" && !Number.isInteger(e) && y(`The v-for range expect an integer value but got ${e}.`), s = new Array(e);
    for (let l = 0; l < e; l++)
      s[l] = t(l + 1, l, void 0, r);
  } else if (k(e))
    if (e[Symbol.iterator])
      s = Array.from(
        e,
        (l, f) => t(l, f, void 0, r)
      );
    else {
      const l = Object.keys(e);
      s = new Array(l.length);
      for (let f = 0, d = l.length; f < d; f++) {
        const p = l[f];
        s[f] = t(e[p], p, f, r);
      }
    }
  else
    s = [];
  return s;
}
const io = (e) => e ? Pr(e) ? Ro(e) : io(e.parent) : null, ht = (
  // Move PURE marker to new line to workaround compiler discarding it
  // due to type annotation
  /* @__PURE__ */ J(/* @__PURE__ */ Object.create(null), {
    $: (e) => e,
    $el: (e) => e.vnode.el,
    $data: (e) => e.data,
    $props: (e) => process.env.NODE_ENV !== "production" ? /* @__PURE__ */ Pe(e.props) : e.props,
    $attrs: (e) => process.env.NODE_ENV !== "production" ? /* @__PURE__ */ Pe(e.attrs) : e.attrs,
    $slots: (e) => process.env.NODE_ENV !== "production" ? /* @__PURE__ */ Pe(e.slots) : e.slots,
    $refs: (e) => process.env.NODE_ENV !== "production" ? /* @__PURE__ */ Pe(e.refs) : e.refs,
    $parent: (e) => io(e.parent),
    $root: (e) => io(e.root),
    $host: (e) => e.ce,
    $emit: (e) => e.emit,
    $options: (e) => hr(e),
    $forceUpdate: (e) => e.f || (e.f = () => {
      Rn(e.update);
    }),
    $nextTick: (e) => e.n || (e.n = Hi.bind(e.proxy)),
    $watch: (e) => ol.bind(e)
  })
), $o = (e) => e === "_" || e === "$", zn = (e, t) => e !== B && !e.__isScriptSetup && F(e, t), pr = {
  get({ _: e }, t) {
    if (t === "__v_skip")
      return !0;
    const { ctx: n, setupState: o, data: s, props: r, accessCache: i, type: l, appContext: f } = e;
    if (process.env.NODE_ENV !== "production" && t === "__isVue")
      return !0;
    if (t[0] !== "$") {
      const g = i[t];
      if (g !== void 0)
        switch (g) {
          case 1:
            return o[t];
          case 2:
            return s[t];
          case 4:
            return n[t];
          case 3:
            return r[t];
        }
      else {
        if (zn(o, t))
          return i[t] = 1, o[t];
        if (s !== B && F(s, t))
          return i[t] = 2, s[t];
        if (F(r, t))
          return i[t] = 3, r[t];
        if (n !== B && F(n, t))
          return i[t] = 4, n[t];
        lo && (i[t] = 0);
      }
    }
    const d = ht[t];
    let p, a;
    if (d)
      return t === "$attrs" ? (z(e.attrs, "get", ""), process.env.NODE_ENV !== "production" && xn()) : process.env.NODE_ENV !== "production" && t === "$slots" && z(e, "get", t), d(e);
    if (
      // css module (injected by vue-loader)
      (p = l.__cssModules) && (p = p[t])
    )
      return p;
    if (n !== B && F(n, t))
      return i[t] = 4, n[t];
    if (
      // global properties
      a = f.config.globalProperties, F(a, t)
    )
      return a[t];
    process.env.NODE_ENV !== "production" && de && (!q(t) || // #1091 avoid internal isRef/isVNode checks on component instance leading
    // to infinite warning loop
    t.indexOf("__v") !== 0) && (s !== B && $o(t[0]) && F(s, t) ? y(
      `Property ${JSON.stringify(
        t
      )} must be accessed via $data because it starts with a reserved character ("$" or "_") and is not proxied on the render context.`
    ) : e === de && y(
      `Property ${JSON.stringify(t)} was accessed during render but is not defined on instance.`
    ));
  },
  set({ _: e }, t, n) {
    const { data: o, setupState: s, ctx: r } = e;
    return zn(s, t) ? (s[t] = n, !0) : process.env.NODE_ENV !== "production" && s.__isScriptSetup && F(s, t) ? (y(`Cannot mutate <script setup> binding "${t}" from Options API.`), !1) : o !== B && F(o, t) ? (o[t] = n, !0) : F(e.props, t) ? (process.env.NODE_ENV !== "production" && y(`Attempting to mutate prop "${t}". Props are readonly.`), !1) : t[0] === "$" && t.slice(1) in e ? (process.env.NODE_ENV !== "production" && y(
      `Attempting to mutate public property "${t}". Properties starting with $ are reserved and readonly.`
    ), !1) : (process.env.NODE_ENV !== "production" && t in e.appContext.config.globalProperties ? Object.defineProperty(r, t, {
      enumerable: !0,
      configurable: !0,
      value: n
    }) : r[t] = n, !0);
  },
  has({
    _: { data: e, setupState: t, accessCache: n, ctx: o, appContext: s, props: r, type: i }
  }, l) {
    let f;
    return !!(n[l] || e !== B && l[0] !== "$" && F(e, l) || zn(t, l) || F(r, l) || F(o, l) || F(ht, l) || F(s.config.globalProperties, l) || (f = i.__cssModules) && f[l]);
  },
  defineProperty(e, t, n) {
    return n.get != null ? e._.accessCache[t] = 0 : F(n, "value") && this.set(e, t, n.value, null), Reflect.defineProperty(e, t, n);
  }
};
process.env.NODE_ENV !== "production" && (pr.ownKeys = (e) => (y(
  "Avoid app logic that relies on enumerating keys on a component instance. The keys will be empty in production mode to avoid performance overhead."
), Reflect.ownKeys(e)));
function yl(e) {
  const t = {};
  return Object.defineProperty(t, "_", {
    configurable: !0,
    enumerable: !1,
    get: () => e
  }), Object.keys(ht).forEach((n) => {
    Object.defineProperty(t, n, {
      configurable: !0,
      enumerable: !1,
      get: () => ht[n](e),
      // intercepted by the proxy so no need for implementation,
      // but needed to prevent set errors
      set: X
    });
  }), t;
}
function Ol(e) {
  const {
    ctx: t,
    propsOptions: [n]
  } = e;
  n && Object.keys(n).forEach((o) => {
    Object.defineProperty(t, o, {
      enumerable: !0,
      configurable: !0,
      get: () => e.props[o],
      set: X
    });
  });
}
function Dl(e) {
  const { ctx: t, setupState: n } = e;
  Object.keys(/* @__PURE__ */ M(n)).forEach((o) => {
    if (!n.__isScriptSetup) {
      if ($o(o[0])) {
        y(
          `setup() return property ${JSON.stringify(
            o
          )} should not start with "$" or "_" which are reserved prefixes for Vue internals.`
        );
        return;
      }
      Object.defineProperty(t, o, {
        enumerable: !0,
        configurable: !0,
        get: () => n[o],
        set: X
      });
    }
  });
}
function zo(e) {
  return T(e) ? e.reduce(
    (t, n) => (t[n] = null, t),
    {}
  ) : e;
}
function wl() {
  const e = /* @__PURE__ */ Object.create(null);
  return (t, n) => {
    e[n] ? y(`${t} property "${n}" is already defined in ${e[n]}.`) : e[n] = t;
  };
}
let lo = !0;
function xl(e) {
  const t = hr(e), n = e.proxy, o = e.ctx;
  lo = !1, t.beforeCreate && Xo(t.beforeCreate, e, "bc");
  const {
    // state
    data: s,
    computed: r,
    methods: i,
    watch: l,
    provide: f,
    inject: d,
    // lifecycle
    created: p,
    beforeMount: a,
    mounted: g,
    beforeUpdate: w,
    updated: A,
    activated: V,
    deactivated: Q,
    beforeDestroy: G,
    beforeUnmount: L,
    destroyed: H,
    unmounted: ae,
    render: S,
    renderTracked: ee,
    renderTriggered: me,
    errorCaptured: te,
    serverPrefetch: re,
    // public API
    expose: Fe,
    inheritAttrs: Ye,
    // assets
    components: ve,
    directives: nn,
    filters: jo
  } = t, ze = process.env.NODE_ENV !== "production" ? wl() : null;
  if (process.env.NODE_ENV !== "production") {
    const [R] = e.propsOptions;
    if (R)
      for (const P in R)
        ze("Props", P);
  }
  if (d && Vl(d, o, ze), i)
    for (const R in i) {
      const P = i[R];
      $(P) ? (process.env.NODE_ENV !== "production" ? Object.defineProperty(o, R, {
        value: P.bind(n),
        configurable: !0,
        enumerable: !0,
        writable: !0
      }) : o[R] = P.bind(n), process.env.NODE_ENV !== "production" && ze("Methods", R)) : process.env.NODE_ENV !== "production" && y(
        `Method "${R}" has type "${typeof P}" in the component definition. Did you reference the function correctly?`
      );
    }
  if (s) {
    process.env.NODE_ENV !== "production" && !$(s) && y(
      "The data option must be a function. Plain object usage is no longer supported."
    );
    const R = s.call(n, n);
    if (process.env.NODE_ENV !== "production" && _o(R) && y(
      "data() returned a Promise - note data() cannot be async; If you intend to perform data fetching before component renders, use async setup() + <Suspense>."
    ), !k(R))
      process.env.NODE_ENV !== "production" && y("data() should return an object.");
    else if (e.data = /* @__PURE__ */ Do(R), process.env.NODE_ENV !== "production")
      for (const P in R)
        ze("Data", P), $o(P[0]) || Object.defineProperty(o, P, {
          configurable: !0,
          enumerable: !0,
          get: () => R[P],
          set: X
        });
  }
  if (lo = !0, r)
    for (const R in r) {
      const P = r[R], Ve = $(P) ? P.bind(n, n) : $(P.get) ? P.get.bind(n, n) : X;
      process.env.NODE_ENV !== "production" && Ve === X && y(`Computed property "${R}" has no getter.`);
      const Ln = !$(P) && $(P.set) ? P.set.bind(n) : process.env.NODE_ENV !== "production" ? () => {
        y(
          `Write operation failed: computed property "${R}" is readonly.`
        );
      } : X, xt = Ue({
        get: Ve,
        set: Ln
      });
      Object.defineProperty(o, R, {
        enumerable: !0,
        configurable: !0,
        get: () => xt.value,
        set: (mt) => xt.value = mt
      }), process.env.NODE_ENV !== "production" && ze("Computed", R);
    }
  if (l)
    for (const R in l)
      dr(l[R], o, n, R);
  if (f) {
    const R = $(f) ? f.call(n) : f;
    Reflect.ownKeys(R).forEach((P) => {
      el(P, R[P]);
    });
  }
  p && Xo(p, e, "c");
  function ie(R, P) {
    T(P) ? P.forEach((Ve) => R(Ve.bind(n))) : P && R(P.bind(n));
  }
  if (ie(al, a), ie(pl, g), ie(dl, w), ie(hl, A), ie(cl, V), ie(fl, Q), ie(El, te), ie(vl, ee), ie(_l, me), ie(gl, L), ie(ar, ae), ie(ml, re), T(Fe))
    if (Fe.length) {
      const R = e.exposed || (e.exposed = {});
      Fe.forEach((P) => {
        Object.defineProperty(R, P, {
          get: () => n[P],
          set: (Ve) => n[P] = Ve,
          enumerable: !0
        });
      });
    } else e.exposed || (e.exposed = {});
  S && e.render === X && (e.render = S), Ye != null && (e.inheritAttrs = Ye), ve && (e.components = ve), nn && (e.directives = nn), re && fr(e);
}
function Vl(e, t, n = X) {
  T(e) && (e = co(e));
  for (const o in e) {
    const s = e[o];
    let r;
    k(s) ? "default" in s ? r = pn(
      s.from || o,
      s.default,
      !0
    ) : r = pn(s.from || o) : r = pn(s), /* @__PURE__ */ Z(r) ? Object.defineProperty(t, o, {
      enumerable: !0,
      configurable: !0,
      get: () => r.value,
      set: (i) => r.value = i
    }) : t[o] = r, process.env.NODE_ENV !== "production" && n("Inject", o);
  }
}
function Xo(e, t, n) {
  je(
    T(e) ? e.map((o) => o.bind(t.proxy)) : e.bind(t.proxy),
    t,
    n
  );
}
function dr(e, t, n, o) {
  let s = o.includes(".") ? cr(n, o) : () => n[o];
  if (q(e)) {
    const r = t[e];
    $(r) ? Yn(s, r) : process.env.NODE_ENV !== "production" && y(`Invalid watch handler specified by key "${e}"`, r);
  } else if ($(e))
    Yn(s, e.bind(n));
  else if (k(e))
    if (T(e))
      e.forEach((r) => dr(r, t, n, o));
    else {
      const r = $(e.handler) ? e.handler.bind(n) : t[e.handler];
      $(r) ? Yn(s, r, e) : process.env.NODE_ENV !== "production" && y(`Invalid watch handler specified by key "${e.handler}"`, r);
    }
  else process.env.NODE_ENV !== "production" && y(`Invalid watch option: "${o}"`, e);
}
function hr(e) {
  const t = e.type, { mixins: n, extends: o } = t, {
    mixins: s,
    optionsCache: r,
    config: { optionMergeStrategies: i }
  } = e.appContext, l = r.get(t);
  let f;
  return l ? f = l : !s.length && !n && !o ? f = t : (f = {}, s.length && s.forEach(
    (d) => wn(f, d, i, !0)
  ), wn(f, t, i)), k(t) && r.set(t, f), f;
}
function wn(e, t, n, o = !1) {
  const { mixins: s, extends: r } = t;
  r && wn(e, r, n, !0), s && s.forEach(
    (i) => wn(e, i, n, !0)
  );
  for (const i in t)
    if (o && i === "expose")
      process.env.NODE_ENV !== "production" && y(
        '"expose" option is ignored when declared in mixins or extends. It should only be declared in the base component itself.'
      );
    else {
      const l = Sl[i] || n && n[i];
      e[i] = l ? l(e[i], t[i]) : t[i];
    }
  return e;
}
const Sl = {
  data: Zo,
  props: Qo,
  emits: Qo,
  // objects
  methods: Rt,
  computed: Rt,
  // lifecycle
  beforeCreate: oe,
  created: oe,
  beforeMount: oe,
  mounted: oe,
  beforeUpdate: oe,
  updated: oe,
  beforeDestroy: oe,
  beforeUnmount: oe,
  destroyed: oe,
  unmounted: oe,
  activated: oe,
  deactivated: oe,
  errorCaptured: oe,
  serverPrefetch: oe,
  // assets
  components: Rt,
  directives: Rt,
  // watch
  watch: Tl,
  // provide / inject
  provide: Zo,
  inject: Cl
};
function Zo(e, t) {
  return t ? e ? function() {
    return J(
      $(e) ? e.call(this, this) : e,
      $(t) ? t.call(this, this) : t
    );
  } : t : e;
}
function Cl(e, t) {
  return Rt(co(e), co(t));
}
function co(e) {
  if (T(e)) {
    const t = {};
    for (let n = 0; n < e.length; n++)
      t[e[n]] = e[n];
    return t;
  }
  return e;
}
function oe(e, t) {
  return e ? [...new Set([].concat(e, t))] : t;
}
function Rt(e, t) {
  return e ? J(/* @__PURE__ */ Object.create(null), e, t) : t;
}
function Qo(e, t) {
  return e ? T(e) && T(t) ? [.../* @__PURE__ */ new Set([...e, ...t])] : J(
    /* @__PURE__ */ Object.create(null),
    zo(e),
    zo(t ?? {})
  ) : t;
}
function Tl(e, t) {
  if (!e) return t;
  if (!t) return e;
  const n = J(/* @__PURE__ */ Object.create(null), e);
  for (const o in t)
    n[o] = oe(e[o], t[o]);
  return n;
}
function gr() {
  return {
    app: null,
    config: {
      isNativeTag: ws,
      performance: !1,
      globalProperties: {},
      optionMergeStrategies: {},
      errorHandler: void 0,
      warnHandler: void 0,
      compilerOptions: {}
    },
    mixins: [],
    components: {},
    directives: {},
    provides: /* @__PURE__ */ Object.create(null),
    optionsCache: /* @__PURE__ */ new WeakMap(),
    propsCache: /* @__PURE__ */ new WeakMap(),
    emitsCache: /* @__PURE__ */ new WeakMap()
  };
}
let $l = 0;
function Al(e, t) {
  return function(o, s = null) {
    $(o) || (o = J({}, o)), s != null && !k(s) && (process.env.NODE_ENV !== "production" && y("root props passed to app.mount() must be an object."), s = null);
    const r = gr(), i = /* @__PURE__ */ new WeakSet(), l = [];
    let f = !1;
    const d = r.app = {
      _uid: $l++,
      _component: o,
      _props: s,
      _container: null,
      _context: r,
      _instance: null,
      version: as,
      get config() {
        return r.config;
      },
      set config(p) {
        process.env.NODE_ENV !== "production" && y(
          "app.config cannot be replaced. Modify individual options instead."
        );
      },
      use(p, ...a) {
        return i.has(p) ? process.env.NODE_ENV !== "production" && y("Plugin has already been applied to target app.") : p && $(p.install) ? (i.add(p), p.install(d, ...a)) : $(p) ? (i.add(p), p(d, ...a)) : process.env.NODE_ENV !== "production" && y(
          'A plugin must either be a function or an object with an "install" function.'
        ), d;
      },
      mixin(p) {
        return r.mixins.includes(p) ? process.env.NODE_ENV !== "production" && y(
          "Mixin has already been applied to target app" + (p.name ? `: ${p.name}` : "")
        ) : r.mixins.push(p), d;
      },
      component(p, a) {
        return process.env.NODE_ENV !== "production" && ho(p, r.config), a ? (process.env.NODE_ENV !== "production" && r.components[p] && y(`Component "${p}" has already been registered in target app.`), r.components[p] = a, d) : r.components[p];
      },
      directive(p, a) {
        return process.env.NODE_ENV !== "production" && ir(p), a ? (process.env.NODE_ENV !== "production" && r.directives[p] && y(`Directive "${p}" has already been registered in target app.`), r.directives[p] = a, d) : r.directives[p];
      },
      mount(p, a, g) {
        if (f)
          process.env.NODE_ENV !== "production" && y(
            "App has already been mounted.\nIf you want to remount the same app, move your app creation logic into a factory function and create fresh app instances for each mount - e.g. `const createMyApp = () => createApp(App)`"
          );
        else {
          process.env.NODE_ENV !== "production" && p.__vue_app__ && y(
            "There is already an app instance mounted on the host container.\n If you want to mount another app on the same host container, you need to unmount the previous app by calling `app.unmount()` first."
          );
          const w = d._ceVNode || ke(o, s);
          return w.appContext = r, g === !0 ? g = "svg" : g === !1 && (g = void 0), process.env.NODE_ENV !== "production" && (r.reload = () => {
            const A = st(w);
            A.el = null, e(A, p, g);
          }), e(w, p, g), f = !0, d._container = p, p.__vue_app__ = d, process.env.NODE_ENV !== "production" && (d._instance = w.component, Ki(d, as)), Ro(w.component);
        }
      },
      onUnmount(p) {
        process.env.NODE_ENV !== "production" && typeof p != "function" && y(
          `Expected function as first argument to app.onUnmount(), but got ${typeof p}`
        ), l.push(p);
      },
      unmount() {
        f ? (je(
          l,
          d._instance,
          16
        ), e(null, d._container), process.env.NODE_ENV !== "production" && (d._instance = null, Gi(d)), delete d._container.__vue_app__) : process.env.NODE_ENV !== "production" && y("Cannot unmount an app that is not mounted.");
      },
      provide(p, a) {
        return process.env.NODE_ENV !== "production" && p in r.provides && (F(r.provides, p) ? y(
          `App already provides property with key "${String(p)}". It will be overwritten with the new value.`
        ) : y(
          `App already provides property with key "${String(p)}" inherited from its parent element. It will be overwritten with the new value.`
        )), r.provides[p] = a, d;
      },
      runWithContext(p) {
        const a = Ot;
        Ot = d;
        try {
          return p();
        } finally {
          Ot = a;
        }
      }
    };
    return d;
  };
}
let Ot = null;
const Il = (e, t) => t === "modelValue" || t === "model-value" ? e.modelModifiers : e[`${t}Modifiers`] || e[`${ye(t)}Modifiers`] || e[`${ot(t)}Modifiers`];
function Ml(e, t, ...n) {
  if (e.isUnmounted) return;
  const o = e.vnode.props || B;
  if (process.env.NODE_ENV !== "production") {
    const {
      emitsOptions: p,
      propsOptions: [a]
    } = e;
    if (p)
      if (!(t in p))
        (!a || !(ct(ye(t)) in a)) && y(
          `Component emitted event "${t}" but it is neither declared in the emits option nor as an "${ct(ye(t))}" prop.`
        );
      else {
        const g = p[t];
        $(g) && (g(...n) || y(
          `Invalid event arguments: event validation failed for event "${t}".`
        ));
      }
  }
  let s = n;
  const r = t.startsWith("update:"), i = r && Il(o, t.slice(7));
  if (i && (i.trim && (s = n.map((p) => q(p) ? p.trim() : p)), i.number && (s = n.map(Gr))), process.env.NODE_ENV !== "production" && Zi(e, t, s), process.env.NODE_ENV !== "production") {
    const p = t.toLowerCase();
    p !== t && o[ct(p)] && y(
      `Event "${p}" is emitted in component ${tn(
        e,
        e.type
      )} but the handler is registered for "${t}". Note that HTML attributes are case-insensitive and you cannot use v-on to listen to camelCase events when using in-DOM templates. You should probably use "${ot(
        t
      )}" instead of "${t}".`
    );
  }
  let l, f = o[l = ct(t)] || // also try camelCase event handler (#2249)
  o[l = ct(ye(t))];
  !f && r && (f = o[l = ct(ot(t))]), f && je(
    f,
    e,
    6,
    s
  );
  const d = o[l + "Once"];
  if (d) {
    if (!e.emitted)
      e.emitted = {};
    else if (e.emitted[l])
      return;
    e.emitted[l] = !0, je(
      d,
      e,
      6,
      s
    );
  }
}
const Pl = /* @__PURE__ */ new WeakMap();
function mr(e, t, n = !1) {
  const o = n ? Pl : t.emitsCache, s = o.get(e);
  if (s !== void 0)
    return s;
  const r = e.emits;
  let i = {}, l = !1;
  if (!$(e)) {
    const f = (d) => {
      const p = mr(d, t, !0);
      p && (l = !0, J(i, p));
    };
    !n && t.mixins.length && t.mixins.forEach(f), e.extends && f(e.extends), e.mixins && e.mixins.forEach(f);
  }
  return !r && !l ? (k(e) && o.set(e, null), null) : (T(r) ? r.forEach((f) => i[f] = null) : J(i, r), k(e) && o.set(e, i), i);
}
function Fn(e, t) {
  return !e || !Yt(t) ? !1 : (t = t.slice(2).replace(/Once$/, ""), F(e, t[0].toLowerCase() + t.slice(1)) || F(e, ot(t)) || F(e, t));
}
let fo = !1;
function xn() {
  fo = !0;
}
function es(e) {
  const {
    type: t,
    vnode: n,
    proxy: o,
    withProxy: s,
    propsOptions: [r],
    slots: i,
    attrs: l,
    emit: f,
    render: d,
    renderCache: p,
    props: a,
    data: g,
    setupState: w,
    ctx: A,
    inheritAttrs: V
  } = e, Q = On(e);
  let G, L;
  process.env.NODE_ENV !== "production" && (fo = !1);
  try {
    if (n.shapeFlag & 4) {
      const S = s || o, ee = process.env.NODE_ENV !== "production" && w.__isScriptSetup ? new Proxy(S, {
        get(me, te, re) {
          return y(
            `Property '${String(
              te
            )}' was accessed via 'this'. Avoid using 'this' in templates.`
          ), Reflect.get(me, te, re);
        }
      }) : S;
      G = Ee(
        d.call(
          ee,
          S,
          p,
          process.env.NODE_ENV !== "production" ? /* @__PURE__ */ Pe(a) : a,
          w,
          g,
          A
        )
      ), L = l;
    } else {
      const S = t;
      process.env.NODE_ENV !== "production" && l === a && xn(), G = Ee(
        S.length > 1 ? S(
          process.env.NODE_ENV !== "production" ? /* @__PURE__ */ Pe(a) : a,
          process.env.NODE_ENV !== "production" ? {
            get attrs() {
              return xn(), /* @__PURE__ */ Pe(l);
            },
            slots: i,
            emit: f
          } : { attrs: l, slots: i, emit: f }
        ) : S(
          process.env.NODE_ENV !== "production" ? /* @__PURE__ */ Pe(a) : a,
          null
        )
      ), L = t.props ? l : Rl(l);
    }
  } catch (S) {
    Wt.length = 0, Xt(S, e, 1), G = ke(ge);
  }
  let H = G, ae;
  if (process.env.NODE_ENV !== "production" && G.patchFlag > 0 && G.patchFlag & 2048 && ([H, ae] = _r(G)), L && V !== !1) {
    const S = Object.keys(L), { shapeFlag: ee } = H;
    if (S.length) {
      if (ee & 7)
        r && S.some(_n) && (L = jl(
          L,
          r
        )), H = st(H, L, !1, !0);
      else if (process.env.NODE_ENV !== "production" && !fo && H.type !== ge) {
        const me = Object.keys(l), te = [], re = [];
        for (let Fe = 0, Ye = me.length; Fe < Ye; Fe++) {
          const ve = me[Fe];
          Yt(ve) ? _n(ve) || te.push(ve[2].toLowerCase() + ve.slice(3)) : re.push(ve);
        }
        re.length && y(
          `Extraneous non-props attributes (${re.join(", ")}) were passed to component but could not be automatically inherited because component renders fragment or text or teleport root nodes.`
        ), te.length && y(
          `Extraneous non-emits event listeners (${te.join(", ")}) were passed to component but could not be automatically inherited because component renders fragment or text root nodes. If the listener is intended to be a component custom event listener only, declare it using the "emits" option.`
        );
      }
    }
  }
  return n.dirs && (process.env.NODE_ENV !== "production" && !ts(H) && y(
    "Runtime directive used on component with non-element root node. The directives will not function as intended."
  ), H = st(H, null, !1, !0), H.dirs = H.dirs ? H.dirs.concat(n.dirs) : n.dirs), n.transition && (process.env.NODE_ENV !== "production" && !ts(H) && y(
    "Component inside <Transition> renders non-element root node that cannot be animated."
  ), Co(H, n.transition)), process.env.NODE_ENV !== "production" && ae ? ae(H) : G = H, On(Q), G;
}
const _r = (e) => {
  const t = e.children, n = e.dynamicChildren, o = Ao(t, !1);
  if (o) {
    if (process.env.NODE_ENV !== "production" && o.patchFlag > 0 && o.patchFlag & 2048)
      return _r(o);
  } else return [e, void 0];
  const s = t.indexOf(o), r = n ? n.indexOf(o) : -1, i = (l) => {
    t[s] = l, n && (r > -1 ? n[r] = l : l.patchFlag > 0 && (e.dynamicChildren = [...n, l]));
  };
  return [Ee(o), i];
};
function Ao(e, t = !0) {
  let n;
  for (let o = 0; o < e.length; o++) {
    const s = e[o];
    if (Hn(s)) {
      if (s.type !== ge || s.children === "v-if") {
        if (n)
          return;
        if (n = s, process.env.NODE_ENV !== "production" && t && n.patchFlag > 0 && n.patchFlag & 2048)
          return Ao(n.children);
      }
    } else
      return;
  }
  return n;
}
const Rl = (e) => {
  let t;
  for (const n in e)
    (n === "class" || n === "style" || Yt(n)) && ((t || (t = {}))[n] = e[n]);
  return t;
}, jl = (e, t) => {
  const n = {};
  for (const o in e)
    (!_n(o) || !(o.slice(9) in t)) && (n[o] = e[o]);
  return n;
}, ts = (e) => e.shapeFlag & 7 || e.type === ge;
function Fl(e, t, n) {
  const { props: o, children: s, component: r } = e, { props: i, children: l, patchFlag: f } = t, d = r.emitsOptions;
  if (process.env.NODE_ENV !== "production" && (s || l) && Ne || t.dirs || t.transition)
    return !0;
  if (n && f >= 0) {
    if (f & 1024)
      return !0;
    if (f & 16)
      return o ? ns(o, i, d) : !!i;
    if (f & 8) {
      const p = t.dynamicProps;
      for (let a = 0; a < p.length; a++) {
        const g = p[a];
        if (i[g] !== o[g] && !Fn(d, g))
          return !0;
      }
    }
  } else
    return (s || l) && (!l || !l.$stable) ? !0 : o === i ? !1 : o ? i ? ns(o, i, d) : !0 : !!i;
  return !1;
}
function ns(e, t, n) {
  const o = Object.keys(t);
  if (o.length !== Object.keys(e).length)
    return !0;
  for (let s = 0; s < o.length; s++) {
    const r = o[s];
    if (t[r] !== e[r] && !Fn(n, r))
      return !0;
  }
  return !1;
}
function Hl({ vnode: e, parent: t }, n) {
  for (; t; ) {
    const o = t.subTree;
    if (o.suspense && o.suspense.activeBranch === e && (o.el = e.el), o === e)
      (e = t.vnode).el = n, t = t.parent;
    else
      break;
  }
}
const vr = {}, Er = () => Object.create(vr), Nr = (e) => Object.getPrototypeOf(e) === vr;
function Ll(e, t, n, o = !1) {
  const s = {}, r = Er();
  e.propsDefaults = /* @__PURE__ */ Object.create(null), br(e, t, s, r);
  for (const i in e.propsOptions[0])
    i in s || (s[i] = void 0);
  process.env.NODE_ENV !== "production" && Or(t || {}, s, e), n ? e.props = o ? s : /* @__PURE__ */ wi(s) : e.type.props ? e.props = s : e.props = r, e.attrs = r;
}
function Ul(e) {
  for (; e; ) {
    if (e.type.__hmrId) return !0;
    e = e.parent;
  }
}
function Wl(e, t, n, o) {
  const {
    props: s,
    attrs: r,
    vnode: { patchFlag: i }
  } = e, l = /* @__PURE__ */ M(s), [f] = e.propsOptions;
  let d = !1;
  if (
    // always force full diff in dev
    // - #1942 if hmr is enabled with sfc component
    // - vite#872 non-sfc component used by sfc component
    !(process.env.NODE_ENV !== "production" && Ul(e)) && (o || i > 0) && !(i & 16)
  ) {
    if (i & 8) {
      const p = e.vnode.dynamicProps;
      for (let a = 0; a < p.length; a++) {
        let g = p[a];
        if (Fn(e.emitsOptions, g))
          continue;
        const w = t[g];
        if (f)
          if (F(r, g))
            w !== r[g] && (r[g] = w, d = !0);
          else {
            const A = ye(g);
            s[A] = uo(
              f,
              l,
              A,
              w,
              e,
              !1
            );
          }
        else
          w !== r[g] && (r[g] = w, d = !0);
      }
    }
  } else {
    br(e, t, s, r) && (d = !0);
    let p;
    for (const a in l)
      (!t || // for camelCase
      !F(t, a) && // it's possible the original props was passed in as kebab-case
      // and converted to camelCase (#955)
      ((p = ot(a)) === a || !F(t, p))) && (f ? n && // for camelCase
      (n[a] !== void 0 || // for kebab-case
      n[p] !== void 0) && (s[a] = uo(
        f,
        l,
        a,
        void 0,
        e,
        !0
      )) : delete s[a]);
    if (r !== l)
      for (const a in r)
        (!t || !F(t, a)) && (delete r[a], d = !0);
  }
  d && Me(e.attrs, "set", ""), process.env.NODE_ENV !== "production" && Or(t || {}, s, e);
}
function br(e, t, n, o) {
  const [s, r] = e.propsOptions;
  let i = !1, l;
  if (t)
    for (let f in t) {
      if (jt(f))
        continue;
      const d = t[f];
      let p;
      s && F(s, p = ye(f)) ? !r || !r.includes(p) ? n[p] = d : (l || (l = {}))[p] = d : Fn(e.emitsOptions, f) || (!(f in o) || d !== o[f]) && (o[f] = d, i = !0);
    }
  if (r) {
    const f = /* @__PURE__ */ M(n), d = l || B;
    for (let p = 0; p < r.length; p++) {
      const a = r[p];
      n[a] = uo(
        s,
        f,
        a,
        d[a],
        e,
        !F(d, a)
      );
    }
  }
  return i;
}
function uo(e, t, n, o, s, r) {
  const i = e[n];
  if (i != null) {
    const l = F(i, "default");
    if (l && o === void 0) {
      const f = i.default;
      if (i.type !== Function && !i.skipFactory && $(f)) {
        const { propsDefaults: d } = s;
        if (n in d)
          o = d[n];
        else {
          const p = en(s);
          o = d[n] = f.call(
            null,
            t
          ), p();
        }
      } else
        o = f;
      s.ce && s.ce._setProp(n, o);
    }
    i[
      0
      /* shouldCast */
    ] && (r && !l ? o = !1 : i[
      1
      /* shouldCastTrue */
    ] && (o === "" || o === ot(n)) && (o = !0));
  }
  return o;
}
const Bl = /* @__PURE__ */ new WeakMap();
function yr(e, t, n = !1) {
  const o = n ? Bl : t.propsCache, s = o.get(e);
  if (s)
    return s;
  const r = e.props, i = {}, l = [];
  let f = !1;
  if (!$(e)) {
    const p = (a) => {
      f = !0;
      const [g, w] = yr(a, t, !0);
      J(i, g), w && l.push(...w);
    };
    !n && t.mixins.length && t.mixins.forEach(p), e.extends && p(e.extends), e.mixins && e.mixins.forEach(p);
  }
  if (!r && !f)
    return k(e) && o.set(e, bt), bt;
  if (T(r))
    for (let p = 0; p < r.length; p++) {
      process.env.NODE_ENV !== "production" && !q(r[p]) && y("props must be strings when using array syntax.", r[p]);
      const a = ye(r[p]);
      os(a) && (i[a] = B);
    }
  else if (r) {
    process.env.NODE_ENV !== "production" && !k(r) && y("invalid props options", r);
    for (const p in r) {
      const a = ye(p);
      if (os(a)) {
        const g = r[p], w = i[a] = T(g) || $(g) ? { type: g } : J({}, g), A = w.type;
        let V = !1, Q = !0;
        if (T(A))
          for (let G = 0; G < A.length; ++G) {
            const L = A[G], H = $(L) && L.name;
            if (H === "Boolean") {
              V = !0;
              break;
            } else H === "String" && (Q = !1);
          }
        else
          V = $(A) && A.name === "Boolean";
        w[
          0
          /* shouldCast */
        ] = V, w[
          1
          /* shouldCastTrue */
        ] = Q, (V || F(w, "default")) && l.push(a);
      }
    }
  }
  const d = [i, l];
  return k(e) && o.set(e, d), d;
}
function os(e) {
  return e[0] !== "$" && !jt(e) ? !0 : (process.env.NODE_ENV !== "production" && y(`Invalid prop name: "${e}" is a reserved property.`), !1);
}
function kl(e) {
  return e === null ? "null" : typeof e == "function" ? e.name || "" : typeof e == "object" && e.constructor && e.constructor.name || "";
}
function Or(e, t, n) {
  const o = /* @__PURE__ */ M(t), s = n.propsOptions[0], r = Object.keys(e).map((i) => ye(i));
  for (const i in s) {
    let l = s[i];
    l != null && Kl(
      i,
      o[i],
      l,
      process.env.NODE_ENV !== "production" ? /* @__PURE__ */ Pe(o) : o,
      !r.includes(i)
    );
  }
}
function Kl(e, t, n, o, s) {
  const { type: r, required: i, validator: l, skipCheck: f } = n;
  if (i && s) {
    y('Missing required prop: "' + e + '"');
    return;
  }
  if (!(t == null && !i)) {
    if (r != null && r !== !0 && !f) {
      let d = !1;
      const p = T(r) ? r : [r], a = [];
      for (let g = 0; g < p.length && !d; g++) {
        const { valid: w, expectedType: A } = ql(t, p[g]);
        a.push(A || ""), d = w;
      }
      if (!d) {
        y(Jl(e, t, a));
        return;
      }
    }
    l && !l(t, o) && y('Invalid prop: custom validator check failed for prop "' + e + '".');
  }
}
const Gl = /* @__PURE__ */ qe(
  "String,Number,Boolean,Function,Symbol,BigInt"
);
function ql(e, t) {
  let n;
  const o = kl(t);
  if (o === "null")
    n = e === null;
  else if (Gl(o)) {
    const s = typeof e;
    n = s === o.toLowerCase(), !n && s === "object" && (n = e instanceof t);
  } else o === "Object" ? n = k(e) : o === "Array" ? n = T(e) : n = e instanceof t;
  return {
    valid: n,
    expectedType: o
  };
}
function Jl(e, t, n) {
  if (n.length === 0)
    return `Prop type [] for prop "${e}" won't match anything. Did you mean to use type Array instead?`;
  let o = `Invalid prop: type check failed for prop "${e}". Expected ${n.map($n).join(" | ")}`;
  const s = n[0], r = vo(t), i = ss(t, s), l = ss(t, r);
  return n.length === 1 && rs(s) && !Yl(s, r) && (o += ` with value ${i}`), o += `, got ${r} `, rs(r) && (o += `with value ${l}.`), o;
}
function ss(e, t) {
  return t === "String" ? `"${e}"` : t === "Number" ? `${Number(e)}` : `${e}`;
}
function rs(e) {
  return ["string", "number", "boolean"].some((n) => e.toLowerCase() === n);
}
function Yl(...e) {
  return e.some((t) => t.toLowerCase() === "boolean");
}
const Io = (e) => e === "_" || e === "_ctx" || e === "$stable", Mo = (e) => T(e) ? e.map(Ee) : [Ee(e)], zl = (e, t, n) => {
  if (t._n)
    return t;
  const o = Qi((...s) => (process.env.NODE_ENV !== "production" && Y && !(n === null && de) && !(n && n.root !== Y.root) && y(
    `Slot "${e}" invoked outside of the render function: this will not track dependencies used in the slot. Invoke the slot function inside the render function instead.`
  ), Mo(t(...s))), n);
  return o._c = !1, o;
}, Dr = (e, t, n) => {
  const o = e._ctx;
  for (const s in e) {
    if (Io(s)) continue;
    const r = e[s];
    if ($(r))
      t[s] = zl(s, r, o);
    else if (r != null) {
      process.env.NODE_ENV !== "production" && y(
        `Non-function value encountered for slot "${s}". Prefer function slots for better performance.`
      );
      const i = Mo(r);
      t[s] = () => i;
    }
  }
}, wr = (e, t) => {
  process.env.NODE_ENV !== "production" && !To(e.vnode) && y(
    "Non-function value encountered for default slot. Prefer function slots for better performance."
  );
  const n = Mo(t);
  e.slots.default = () => n;
}, ao = (e, t, n) => {
  for (const o in t)
    (n || !Io(o)) && (e[o] = t[o]);
}, Xl = (e, t, n) => {
  const o = e.slots = Er();
  if (e.vnode.shapeFlag & 32) {
    const s = t._;
    s ? (ao(o, t, n), n && vn(o, "_", s, !0)) : Dr(t, o);
  } else t && wr(e, t);
}, Zl = (e, t, n) => {
  const { vnode: o, slots: s } = e;
  let r = !0, i = B;
  if (o.shapeFlag & 32) {
    const l = t._;
    l ? process.env.NODE_ENV !== "production" && Ne ? (ao(s, t, n), Me(e, "set", "$slots")) : n && l === 1 ? r = !1 : ao(s, t, n) : (r = !t.$stable, Dr(t, s)), i = t;
  } else t && (wr(e, t), i = { default: 1 });
  if (r)
    for (const l in s)
      !Io(l) && i[l] == null && delete s[l];
};
let At, Be;
function vt(e, t) {
  e.appContext.config.performance && Vn() && Be.mark(`vue-${t}-${e.uid}`), process.env.NODE_ENV !== "production" && zi(e, t, Vn() ? Be.now() : Date.now());
}
function Et(e, t) {
  if (e.appContext.config.performance && Vn()) {
    const n = `vue-${t}-${e.uid}`, o = n + ":end", s = `<${tn(e, e.type)}> ${t}`;
    Be.mark(o), Be.measure(s, n, o), Be.clearMeasures(s), Be.clearMarks(n), Be.clearMarks(o);
  }
  process.env.NODE_ENV !== "production" && Xi(e, t, Vn() ? Be.now() : Date.now());
}
function Vn() {
  return At !== void 0 || (typeof window < "u" && window.performance ? (At = !0, Be = window.performance) : At = !1), At;
}
function Ql() {
  const e = [];
  if (process.env.NODE_ENV !== "production" && e.length) {
    const t = e.length > 1;
    console.warn(
      `Feature flag${t ? "s" : ""} ${e.join(", ")} ${t ? "are" : "is"} not explicitly defined. You are running the esm-bundler build of Vue, which expects these compile-time feature flags to be globally injected via the bundler config in order to get better tree-shaking in the production bundle.

For more details, see https://link.vuejs.org/feature-flags.`
    );
  }
}
const pe = sc;
function ec(e) {
  return tc(e);
}
function tc(e, t) {
  Ql();
  const n = zt();
  n.__VUE__ = !0, process.env.NODE_ENV !== "production" && Vo(n.__VUE_DEVTOOLS_GLOBAL_HOOK__, n);
  const {
    insert: o,
    remove: s,
    patchProp: r,
    createElement: i,
    createText: l,
    createComment: f,
    setText: d,
    setElementText: p,
    parentNode: a,
    nextSibling: g,
    setScopeId: w = X,
    insertStaticContent: A
  } = e, V = (c, u, h, E = null, _ = null, m = null, O = void 0, N = null, b = process.env.NODE_ENV !== "production" && Ne ? !1 : !!u.dynamicChildren) => {
    if (c === u)
      return;
    c && !It(c, u) && (E = on(c), Xe(c, _, m, !0), c = null), u.patchFlag === -2 && (b = !1, u.dynamicChildren = null);
    const { type: v, ref: C, shapeFlag: D } = u;
    switch (v) {
      case Qt:
        Q(c, u, h, E);
        break;
      case ge:
        G(c, u, h, E);
        break;
      case hn:
        c == null ? L(u, h, E, O) : process.env.NODE_ENV !== "production" && H(c, u, h, O);
        break;
      case _e:
        nn(
          c,
          u,
          h,
          E,
          _,
          m,
          O,
          N,
          b
        );
        break;
      default:
        D & 1 ? ee(
          c,
          u,
          h,
          E,
          _,
          m,
          O,
          N,
          b
        ) : D & 6 ? jo(
          c,
          u,
          h,
          E,
          _,
          m,
          O,
          N,
          b
        ) : D & 64 || D & 128 ? v.process(
          c,
          u,
          h,
          E,
          _,
          m,
          O,
          N,
          b,
          St
        ) : process.env.NODE_ENV !== "production" && y("Invalid VNode type:", v, `(${typeof v})`);
    }
    C != null && _ ? Lt(C, c && c.ref, m, u || c, !u) : C == null && c && c.ref != null && Lt(c.ref, null, m, c, !0);
  }, Q = (c, u, h, E) => {
    if (c == null)
      o(
        u.el = l(u.children),
        h,
        E
      );
    else {
      const _ = u.el = c.el;
      if (u.children !== c.children)
        if (process.env.NODE_ENV !== "production" && Ne && u.patchFlag === -1 && "__elIndex" in c) {
          const m = h.childNodes, O = l(u.children), N = m[u.__elIndex = c.__elIndex];
          o(O, h, N), s(N);
        } else
          d(_, u.children);
    }
  }, G = (c, u, h, E) => {
    c == null ? o(
      u.el = f(u.children || ""),
      h,
      E
    ) : u.el = c.el;
  }, L = (c, u, h, E) => {
    [c.el, c.anchor] = A(
      c.children,
      u,
      h,
      E,
      c.el,
      c.anchor
    );
  }, H = (c, u, h, E) => {
    if (u.children !== c.children) {
      const _ = g(c.anchor);
      S(c), [u.el, u.anchor] = A(
        u.children,
        h,
        _,
        E
      );
    } else
      u.el = c.el, u.anchor = c.anchor;
  }, ae = ({ el: c, anchor: u }, h, E) => {
    let _;
    for (; c && c !== u; )
      _ = g(c), o(c, h, E), c = _;
    o(u, h, E);
  }, S = ({ el: c, anchor: u }) => {
    let h;
    for (; c && c !== u; )
      h = g(c), s(c), c = h;
    s(u);
  }, ee = (c, u, h, E, _, m, O, N, b) => {
    if (u.type === "svg" ? O = "svg" : u.type === "math" && (O = "mathml"), c == null)
      me(
        u,
        h,
        E,
        _,
        m,
        O,
        N,
        b
      );
    else {
      const v = c.el && c.el._isVueCE ? c.el : null;
      try {
        v && v._beginPatch(), Fe(
          c,
          u,
          _,
          m,
          O,
          N,
          b
        );
      } finally {
        v && v._endPatch();
      }
    }
  }, me = (c, u, h, E, _, m, O, N) => {
    let b, v;
    const { props: C, shapeFlag: D, transition: x, dirs: I } = c;
    if (b = c.el = i(
      c.type,
      m,
      C && C.is,
      C
    ), D & 8 ? p(b, c.children) : D & 16 && re(
      c.children,
      b,
      null,
      E,
      _,
      Xn(c, m),
      O,
      N
    ), I && it(c, null, E, "created"), te(b, c, c.scopeId, O, E), C) {
      for (const K in C)
        K !== "value" && !jt(K) && r(b, K, null, C[K], m, E);
      "value" in C && r(b, "value", null, C.value, m), (v = C.onVnodeBeforeMount) && $e(v, E, c);
    }
    process.env.NODE_ENV !== "production" && (vn(b, "__vnode", c, !0), vn(b, "__vueParentComponent", E, !0)), I && it(c, null, E, "beforeMount");
    const j = nc(_, x);
    j && x.beforeEnter(b), o(b, u, h), ((v = C && C.onVnodeMounted) || j || I) && pe(() => {
      v && $e(v, E, c), j && x.enter(b), I && it(c, null, E, "mounted");
    }, _);
  }, te = (c, u, h, E, _) => {
    if (h && w(c, h), E)
      for (let m = 0; m < E.length; m++)
        w(c, E[m]);
    if (_) {
      let m = _.subTree;
      if (process.env.NODE_ENV !== "production" && m.patchFlag > 0 && m.patchFlag & 2048 && (m = Ao(m.children) || m), u === m || Sr(m.type) && (m.ssContent === u || m.ssFallback === u)) {
        const O = _.vnode;
        te(
          c,
          O,
          O.scopeId,
          O.slotScopeIds,
          _.parent
        );
      }
    }
  }, re = (c, u, h, E, _, m, O, N, b = 0) => {
    for (let v = b; v < c.length; v++) {
      const C = c[v] = N ? et(c[v]) : Ee(c[v]);
      V(
        null,
        C,
        u,
        h,
        E,
        _,
        m,
        O,
        N
      );
    }
  }, Fe = (c, u, h, E, _, m, O) => {
    const N = u.el = c.el;
    process.env.NODE_ENV !== "production" && (N.__vnode = u);
    let { patchFlag: b, dynamicChildren: v, dirs: C } = u;
    b |= c.patchFlag & 16;
    const D = c.props || B, x = u.props || B;
    let I;
    if (h && lt(h, !1), (I = x.onVnodeBeforeUpdate) && $e(I, h, u, c), C && it(u, c, h, "beforeUpdate"), h && lt(h, !0), process.env.NODE_ENV !== "production" && Ne && (b = 0, O = !1, v = null), (D.innerHTML && x.innerHTML == null || D.textContent && x.textContent == null) && p(N, ""), v ? (Ye(
      c.dynamicChildren,
      v,
      N,
      h,
      E,
      Xn(u, _),
      m
    ), process.env.NODE_ENV !== "production" && dn(c, u)) : O || Ve(
      c,
      u,
      N,
      null,
      h,
      E,
      Xn(u, _),
      m,
      !1
    ), b > 0) {
      if (b & 16)
        ve(N, D, x, h, _);
      else if (b & 2 && D.class !== x.class && r(N, "class", null, x.class, _), b & 4 && r(N, "style", D.style, x.style, _), b & 8) {
        const j = u.dynamicProps;
        for (let K = 0; K < j.length; K++) {
          const W = j[K], le = D[W], ce = x[W];
          (ce !== le || W === "value") && r(N, W, le, ce, _, h);
        }
      }
      b & 1 && c.children !== u.children && p(N, u.children);
    } else !O && v == null && ve(N, D, x, h, _);
    ((I = x.onVnodeUpdated) || C) && pe(() => {
      I && $e(I, h, u, c), C && it(u, c, h, "updated");
    }, E);
  }, Ye = (c, u, h, E, _, m, O) => {
    for (let N = 0; N < u.length; N++) {
      const b = c[N], v = u[N], C = (
        // oldVNode may be an errored async setup() component inside Suspense
        // which will not have a mounted element
        b.el && // - In the case of a Fragment, we need to provide the actual parent
        // of the Fragment itself so it can move its children.
        (b.type === _e || // - In the case of different nodes, there is going to be a replacement
        // which also requires the correct parent container
        !It(b, v) || // - In the case of a component, it could contain anything.
        b.shapeFlag & 198) ? a(b.el) : (
          // In other cases, the parent container is not actually used so we
          // just pass the block element here to avoid a DOM parentNode call.
          h
        )
      );
      V(
        b,
        v,
        C,
        null,
        E,
        _,
        m,
        O,
        !0
      );
    }
  }, ve = (c, u, h, E, _) => {
    if (u !== h) {
      if (u !== B)
        for (const m in u)
          !jt(m) && !(m in h) && r(
            c,
            m,
            u[m],
            null,
            _,
            E
          );
      for (const m in h) {
        if (jt(m)) continue;
        const O = h[m], N = u[m];
        O !== N && m !== "value" && r(c, m, N, O, _, E);
      }
      "value" in h && r(c, "value", u.value, h.value, _);
    }
  }, nn = (c, u, h, E, _, m, O, N, b) => {
    const v = u.el = c ? c.el : l(""), C = u.anchor = c ? c.anchor : l("");
    let { patchFlag: D, dynamicChildren: x, slotScopeIds: I } = u;
    process.env.NODE_ENV !== "production" && // #5523 dev root fragment may inherit directives
    (Ne || D & 2048) && (D = 0, b = !1, x = null), I && (N = N ? N.concat(I) : I), c == null ? (o(v, h, E), o(C, h, E), re(
      // #10007
      // such fragment like `<></>` will be compiled into
      // a fragment which doesn't have a children.
      // In this case fallback to an empty array
      u.children || [],
      h,
      C,
      _,
      m,
      O,
      N,
      b
    )) : D > 0 && D & 64 && x && // #2715 the previous fragment could've been a BAILed one as a result
    // of renderSlot() with no valid children
    c.dynamicChildren && c.dynamicChildren.length === x.length ? (Ye(
      c.dynamicChildren,
      x,
      h,
      _,
      m,
      O,
      N
    ), process.env.NODE_ENV !== "production" ? dn(c, u) : (
      // #2080 if the stable fragment has a key, it's a <template v-for> that may
      //  get moved around. Make sure all root level vnodes inherit el.
      // #2134 or if it's a component root, it may also get moved around
      // as the component is being moved.
      (u.key != null || _ && u === _.subTree) && dn(
        c,
        u,
        !0
        /* shallow */
      )
    )) : Ve(
      c,
      u,
      h,
      C,
      _,
      m,
      O,
      N,
      b
    );
  }, jo = (c, u, h, E, _, m, O, N, b) => {
    u.slotScopeIds = N, c == null ? u.shapeFlag & 512 ? _.ctx.activate(
      u,
      h,
      E,
      O,
      b
    ) : ze(
      u,
      h,
      E,
      _,
      m,
      O,
      b
    ) : ie(c, u, b);
  }, ze = (c, u, h, E, _, m, O) => {
    const N = c.component = pc(
      c,
      E,
      _
    );
    if (process.env.NODE_ENV !== "production" && N.type.__hmrId && Ui(N), process.env.NODE_ENV !== "production" && (fn(c), vt(N, "mount")), To(c) && (N.ctx.renderer = St), process.env.NODE_ENV !== "production" && vt(N, "init"), hc(N, !1, O), process.env.NODE_ENV !== "production" && Et(N, "init"), process.env.NODE_ENV !== "production" && Ne && (c.el = null), N.asyncDep) {
      if (_ && _.registerDep(N, R, O), !c.el) {
        const b = N.subTree = ke(ge);
        G(null, b, u, h), c.placeholder = b.el;
      }
    } else
      R(
        N,
        c,
        u,
        h,
        _,
        m,
        O
      );
    process.env.NODE_ENV !== "production" && (un(), Et(N, "mount"));
  }, ie = (c, u, h) => {
    const E = u.component = c.component;
    if (Fl(c, u, h))
      if (E.asyncDep && !E.asyncResolved) {
        process.env.NODE_ENV !== "production" && fn(u), P(E, u, h), process.env.NODE_ENV !== "production" && un();
        return;
      } else
        E.next = u, E.update();
    else
      u.el = c.el, E.vnode = u;
  }, R = (c, u, h, E, _, m, O) => {
    const N = () => {
      if (c.isMounted) {
        let { next: D, bu: x, u: I, parent: j, vnode: K } = c;
        {
          const Ce = xr(c);
          if (Ce) {
            D && (D.el = K.el, P(c, D, O)), Ce.asyncDep.then(() => {
              c.isUnmounted || N();
            });
            return;
          }
        }
        let W = D, le;
        process.env.NODE_ENV !== "production" && fn(D || c.vnode), lt(c, !1), D ? (D.el = K.el, P(c, D, O)) : D = K, x && Tt(x), (le = D.props && D.props.onVnodeBeforeUpdate) && $e(le, j, D, K), lt(c, !0), process.env.NODE_ENV !== "production" && vt(c, "render");
        const ce = es(c);
        process.env.NODE_ENV !== "production" && Et(c, "render");
        const Se = c.subTree;
        c.subTree = ce, process.env.NODE_ENV !== "production" && vt(c, "patch"), V(
          Se,
          ce,
          // parent may have changed if it's in a teleport
          a(Se.el),
          // anchor may have changed if it's in a fragment
          on(Se),
          c,
          _,
          m
        ), process.env.NODE_ENV !== "production" && Et(c, "patch"), D.el = ce.el, W === null && Hl(c, ce.el), I && pe(I, _), (le = D.props && D.props.onVnodeUpdated) && pe(
          () => $e(le, j, D, K),
          _
        ), process.env.NODE_ENV !== "production" && or(c), process.env.NODE_ENV !== "production" && un();
      } else {
        let D;
        const { el: x, props: I } = u, { bm: j, m: K, parent: W, root: le, type: ce } = c, Se = Ut(u);
        lt(c, !1), j && Tt(j), !Se && (D = I && I.onVnodeBeforeMount) && $e(D, W, u), lt(c, !0);
        {
          le.ce && // @ts-expect-error _def is private
          le.ce._def.shadowRoot !== !1 && le.ce._injectChildStyle(ce), process.env.NODE_ENV !== "production" && vt(c, "render");
          const Ce = c.subTree = es(c);
          process.env.NODE_ENV !== "production" && Et(c, "render"), process.env.NODE_ENV !== "production" && vt(c, "patch"), V(
            null,
            Ce,
            h,
            E,
            c,
            _,
            m
          ), process.env.NODE_ENV !== "production" && Et(c, "patch"), u.el = Ce.el;
        }
        if (K && pe(K, _), !Se && (D = I && I.onVnodeMounted)) {
          const Ce = u;
          pe(
            () => $e(D, W, Ce),
            _
          );
        }
        (u.shapeFlag & 256 || W && Ut(W.vnode) && W.vnode.shapeFlag & 256) && c.a && pe(c.a, _), c.isMounted = !0, process.env.NODE_ENV !== "production" && qi(c), u = h = E = null;
      }
    };
    c.scope.on();
    const b = c.effect = new As(N);
    c.scope.off();
    const v = c.update = b.run.bind(b), C = c.job = b.runIfDirty.bind(b);
    C.i = c, C.id = c.uid, b.scheduler = () => Rn(C), lt(c, !0), process.env.NODE_ENV !== "production" && (b.onTrack = c.rtc ? (D) => Tt(c.rtc, D) : void 0, b.onTrigger = c.rtg ? (D) => Tt(c.rtg, D) : void 0), v();
  }, P = (c, u, h) => {
    u.component = c;
    const E = c.vnode.props;
    c.vnode = u, c.next = null, Wl(c, u.props, E, h), Zl(c, u.children, h), we(), Go(c), xe();
  }, Ve = (c, u, h, E, _, m, O, N, b = !1) => {
    const v = c && c.children, C = c ? c.shapeFlag : 0, D = u.children, { patchFlag: x, shapeFlag: I } = u;
    if (x > 0) {
      if (x & 128) {
        xt(
          v,
          D,
          h,
          E,
          _,
          m,
          O,
          N,
          b
        );
        return;
      } else if (x & 256) {
        Ln(
          v,
          D,
          h,
          E,
          _,
          m,
          O,
          N,
          b
        );
        return;
      }
    }
    I & 8 ? (C & 16 && Vt(v, _, m), D !== v && p(h, D)) : C & 16 ? I & 16 ? xt(
      v,
      D,
      h,
      E,
      _,
      m,
      O,
      N,
      b
    ) : Vt(v, _, m, !0) : (C & 8 && p(h, ""), I & 16 && re(
      D,
      h,
      E,
      _,
      m,
      O,
      N,
      b
    ));
  }, Ln = (c, u, h, E, _, m, O, N, b) => {
    c = c || bt, u = u || bt;
    const v = c.length, C = u.length, D = Math.min(v, C);
    let x;
    for (x = 0; x < D; x++) {
      const I = u[x] = b ? et(u[x]) : Ee(u[x]);
      V(
        c[x],
        I,
        h,
        null,
        _,
        m,
        O,
        N,
        b
      );
    }
    v > C ? Vt(
      c,
      _,
      m,
      !0,
      !1,
      D
    ) : re(
      u,
      h,
      E,
      _,
      m,
      O,
      N,
      b,
      D
    );
  }, xt = (c, u, h, E, _, m, O, N, b) => {
    let v = 0;
    const C = u.length;
    let D = c.length - 1, x = C - 1;
    for (; v <= D && v <= x; ) {
      const I = c[v], j = u[v] = b ? et(u[v]) : Ee(u[v]);
      if (It(I, j))
        V(
          I,
          j,
          h,
          null,
          _,
          m,
          O,
          N,
          b
        );
      else
        break;
      v++;
    }
    for (; v <= D && v <= x; ) {
      const I = c[D], j = u[x] = b ? et(u[x]) : Ee(u[x]);
      if (It(I, j))
        V(
          I,
          j,
          h,
          null,
          _,
          m,
          O,
          N,
          b
        );
      else
        break;
      D--, x--;
    }
    if (v > D) {
      if (v <= x) {
        const I = x + 1, j = I < C ? u[I].el : E;
        for (; v <= x; )
          V(
            null,
            u[v] = b ? et(u[v]) : Ee(u[v]),
            h,
            j,
            _,
            m,
            O,
            N,
            b
          ), v++;
      }
    } else if (v > x)
      for (; v <= D; )
        Xe(c[v], _, m, !0), v++;
    else {
      const I = v, j = v, K = /* @__PURE__ */ new Map();
      for (v = j; v <= x; v++) {
        const ne = u[v] = b ? et(u[v]) : Ee(u[v]);
        ne.key != null && (process.env.NODE_ENV !== "production" && K.has(ne.key) && y(
          "Duplicate keys found during update:",
          JSON.stringify(ne.key),
          "Make sure keys are unique."
        ), K.set(ne.key, v));
      }
      let W, le = 0;
      const ce = x - j + 1;
      let Se = !1, Ce = 0;
      const Ct = new Array(ce);
      for (v = 0; v < ce; v++) Ct[v] = 0;
      for (v = I; v <= D; v++) {
        const ne = c[v];
        if (le >= ce) {
          Xe(ne, _, m, !0);
          continue;
        }
        let Te;
        if (ne.key != null)
          Te = K.get(ne.key);
        else
          for (W = j; W <= x; W++)
            if (Ct[W - j] === 0 && It(ne, u[W])) {
              Te = W;
              break;
            }
        Te === void 0 ? Xe(ne, _, m, !0) : (Ct[Te - j] = v + 1, Te >= Ce ? Ce = Te : Se = !0, V(
          ne,
          u[Te],
          h,
          null,
          _,
          m,
          O,
          N,
          b
        ), le++);
      }
      const Ho = Se ? oc(Ct) : bt;
      for (W = Ho.length - 1, v = ce - 1; v >= 0; v--) {
        const ne = j + v, Te = u[ne], Lo = u[ne + 1], Uo = ne + 1 < C ? (
          // #13559, #14173 fallback to el placeholder for unresolved async component
          Lo.el || Vr(Lo)
        ) : E;
        Ct[v] === 0 ? V(
          null,
          Te,
          h,
          Uo,
          _,
          m,
          O,
          N,
          b
        ) : Se && (W < 0 || v !== Ho[W] ? mt(Te, h, Uo, 2) : W--);
      }
    }
  }, mt = (c, u, h, E, _ = null) => {
    const { el: m, type: O, transition: N, children: b, shapeFlag: v } = c;
    if (v & 6) {
      mt(c.component.subTree, u, h, E);
      return;
    }
    if (v & 128) {
      c.suspense.move(u, h, E);
      return;
    }
    if (v & 64) {
      O.move(c, u, h, St);
      return;
    }
    if (O === _e) {
      o(m, u, h);
      for (let D = 0; D < b.length; D++)
        mt(b[D], u, h, E);
      o(c.anchor, u, h);
      return;
    }
    if (O === hn) {
      ae(c, u, h);
      return;
    }
    if (E !== 2 && v & 1 && N)
      if (E === 0)
        N.beforeEnter(m), o(m, u, h), pe(() => N.enter(m), _);
      else {
        const { leave: D, delayLeave: x, afterLeave: I } = N, j = () => {
          c.ctx.isUnmounted ? s(m) : o(m, u, h);
        }, K = () => {
          m._isLeaving && m[il](
            !0
            /* cancelled */
          ), D(m, () => {
            j(), I && I();
          });
        };
        x ? x(m, j, K) : K();
      }
    else
      o(m, u, h);
  }, Xe = (c, u, h, E = !1, _ = !1) => {
    const {
      type: m,
      props: O,
      ref: N,
      children: b,
      dynamicChildren: v,
      shapeFlag: C,
      patchFlag: D,
      dirs: x,
      cacheIndex: I
    } = c;
    if (D === -2 && (_ = !1), N != null && (we(), Lt(N, null, h, c, !0), xe()), I != null && (u.renderCache[I] = void 0), C & 256) {
      u.ctx.deactivate(c);
      return;
    }
    const j = C & 1 && x, K = !Ut(c);
    let W;
    if (K && (W = O && O.onVnodeBeforeUnmount) && $e(W, u, c), C & 6)
      Ur(c.component, h, E);
    else {
      if (C & 128) {
        c.suspense.unmount(h, E);
        return;
      }
      j && it(c, null, u, "beforeUnmount"), C & 64 ? c.type.remove(
        c,
        u,
        h,
        St,
        E
      ) : v && // #5154
      // when v-once is used inside a block, setBlockTracking(-1) marks the
      // parent block with hasOnce: true
      // so that it doesn't take the fast path during unmount - otherwise
      // components nested in v-once are never unmounted.
      !v.hasOnce && // #1153: fast path should not be taken for non-stable (v-for) fragments
      (m !== _e || D > 0 && D & 64) ? Vt(
        v,
        u,
        h,
        !1,
        !0
      ) : (m === _e && D & 384 || !_ && C & 16) && Vt(b, u, h), E && Un(c);
    }
    (K && (W = O && O.onVnodeUnmounted) || j) && pe(() => {
      W && $e(W, u, c), j && it(c, null, u, "unmounted");
    }, h);
  }, Un = (c) => {
    const { type: u, el: h, anchor: E, transition: _ } = c;
    if (u === _e) {
      process.env.NODE_ENV !== "production" && c.patchFlag > 0 && c.patchFlag & 2048 && _ && !_.persisted ? c.children.forEach((O) => {
        O.type === ge ? s(O.el) : Un(O);
      }) : Lr(h, E);
      return;
    }
    if (u === hn) {
      S(c);
      return;
    }
    const m = () => {
      s(h), _ && !_.persisted && _.afterLeave && _.afterLeave();
    };
    if (c.shapeFlag & 1 && _ && !_.persisted) {
      const { leave: O, delayLeave: N } = _, b = () => O(h, m);
      N ? N(c.el, m, b) : b();
    } else
      m();
  }, Lr = (c, u) => {
    let h;
    for (; c !== u; )
      h = g(c), s(c), c = h;
    s(u);
  }, Ur = (c, u, h) => {
    process.env.NODE_ENV !== "production" && c.type.__hmrId && Wi(c);
    const { bum: E, scope: _, job: m, subTree: O, um: N, m: b, a: v } = c;
    is(b), is(v), E && Tt(E), _.stop(), m && (m.flags |= 8, Xe(O, c, u, h)), N && pe(N, u), pe(() => {
      c.isUnmounted = !0;
    }, u), process.env.NODE_ENV !== "production" && Yi(c);
  }, Vt = (c, u, h, E = !1, _ = !1, m = 0) => {
    for (let O = m; O < c.length; O++)
      Xe(c[O], u, h, E, _);
  }, on = (c) => {
    if (c.shapeFlag & 6)
      return on(c.component.subTree);
    if (c.shapeFlag & 128)
      return c.suspense.next();
    const u = g(c.anchor || c.el), h = u && u[sl];
    return h ? g(h) : u;
  };
  let Wn = !1;
  const Fo = (c, u, h) => {
    let E;
    c == null ? u._vnode && (Xe(u._vnode, null, null, !0), E = u._vnode.component) : V(
      u._vnode || null,
      c,
      u,
      null,
      null,
      null,
      h
    ), u._vnode = c, Wn || (Wn = !0, Go(E), er(), Wn = !1);
  }, St = {
    p: V,
    um: Xe,
    m: mt,
    r: Un,
    mt: ze,
    mc: re,
    pc: Ve,
    pbc: Ye,
    n: on,
    o: e
  };
  return {
    render: Fo,
    hydrate: void 0,
    createApp: Al(Fo)
  };
}
function Xn({ type: e, props: t }, n) {
  return n === "svg" && e === "foreignObject" || n === "mathml" && e === "annotation-xml" && t && t.encoding && t.encoding.includes("html") ? void 0 : n;
}
function lt({ effect: e, job: t }, n) {
  n ? (e.flags |= 32, t.flags |= 4) : (e.flags &= -33, t.flags &= -5);
}
function nc(e, t) {
  return (!e || e && !e.pendingBranch) && t && !t.persisted;
}
function dn(e, t, n = !1) {
  const o = e.children, s = t.children;
  if (T(o) && T(s))
    for (let r = 0; r < o.length; r++) {
      const i = o[r];
      let l = s[r];
      l.shapeFlag & 1 && !l.dynamicChildren && ((l.patchFlag <= 0 || l.patchFlag === 32) && (l = s[r] = et(s[r]), l.el = i.el), !n && l.patchFlag !== -2 && dn(i, l)), l.type === Qt && (l.patchFlag !== -1 ? l.el = i.el : l.__elIndex = r + // take fragment start anchor into account
      (e.type === _e ? 1 : 0)), l.type === ge && !l.el && (l.el = i.el), process.env.NODE_ENV !== "production" && l.el && (l.el.__vnode = l);
    }
}
function oc(e) {
  const t = e.slice(), n = [0];
  let o, s, r, i, l;
  const f = e.length;
  for (o = 0; o < f; o++) {
    const d = e[o];
    if (d !== 0) {
      if (s = n[n.length - 1], e[s] < d) {
        t[o] = s, n.push(o);
        continue;
      }
      for (r = 0, i = n.length - 1; r < i; )
        l = r + i >> 1, e[n[l]] < d ? r = l + 1 : i = l;
      d < e[n[r]] && (r > 0 && (t[o] = n[r - 1]), n[r] = o);
    }
  }
  for (r = n.length, i = n[r - 1]; r-- > 0; )
    n[r] = i, i = t[i];
  return n;
}
function xr(e) {
  const t = e.subTree.component;
  if (t)
    return t.asyncDep && !t.asyncResolved ? t : xr(t);
}
function is(e) {
  if (e)
    for (let t = 0; t < e.length; t++)
      e[t].flags |= 8;
}
function Vr(e) {
  if (e.placeholder)
    return e.placeholder;
  const t = e.component;
  return t ? Vr(t.subTree) : null;
}
const Sr = (e) => e.__isSuspense;
function sc(e, t) {
  t && t.pendingBranch ? T(e) ? t.effects.push(...e) : t.effects.push(e) : Qs(e);
}
const _e = /* @__PURE__ */ Symbol.for("v-fgt"), Qt = /* @__PURE__ */ Symbol.for("v-txt"), ge = /* @__PURE__ */ Symbol.for("v-cmt"), hn = /* @__PURE__ */ Symbol.for("v-stc"), Wt = [];
let he = null;
function Ae(e = !1) {
  Wt.push(he = e ? null : []);
}
function rc() {
  Wt.pop(), he = Wt[Wt.length - 1] || null;
}
let qt = 1;
function ls(e, t = !1) {
  qt += e, e < 0 && he && t && (he.hasOnce = !0);
}
function Cr(e) {
  return e.dynamicChildren = qt > 0 ? he || bt : null, rc(), qt > 0 && he && he.push(e), e;
}
function Le(e, t, n, o, s, r) {
  return Cr(
    Bt(
      e,
      t,
      n,
      o,
      s,
      r,
      !0
    )
  );
}
function ic(e, t, n, o, s) {
  return Cr(
    ke(
      e,
      t,
      n,
      o,
      s,
      !0
    )
  );
}
function Hn(e) {
  return e ? e.__v_isVNode === !0 : !1;
}
function It(e, t) {
  if (process.env.NODE_ENV !== "production" && t.shapeFlag & 6 && e.component) {
    const n = an.get(t.type);
    if (n && n.has(e.component))
      return e.shapeFlag &= -257, t.shapeFlag &= -513, !1;
  }
  return e.type === t.type && e.key === t.key;
}
const lc = (...e) => $r(
  ...e
), Tr = ({ key: e }) => e ?? null, gn = ({
  ref: e,
  ref_key: t,
  ref_for: n
}) => (typeof e == "number" && (e = "" + e), e != null ? q(e) || /* @__PURE__ */ Z(e) || $(e) ? { i: de, r: e, k: t, f: !!n } : e : null);
function Bt(e, t = null, n = null, o = 0, s = null, r = e === _e ? 0 : 1, i = !1, l = !1) {
  const f = {
    __v_isVNode: !0,
    __v_skip: !0,
    type: e,
    props: t,
    key: t && Tr(t),
    ref: t && gn(t),
    scopeId: rr,
    slotScopeIds: null,
    children: n,
    component: null,
    suspense: null,
    ssContent: null,
    ssFallback: null,
    dirs: null,
    transition: null,
    el: null,
    anchor: null,
    target: null,
    targetStart: null,
    targetAnchor: null,
    staticCount: 0,
    shapeFlag: r,
    patchFlag: o,
    dynamicProps: s,
    dynamicChildren: null,
    appContext: null,
    ctx: de
  };
  return l ? (Po(f, n), r & 128 && e.normalize(f)) : n && (f.shapeFlag |= q(n) ? 8 : 16), process.env.NODE_ENV !== "production" && f.key !== f.key && y("VNode created with invalid key (NaN). VNode type:", f.type), qt > 0 && // avoid a block node from tracking itself
  !i && // has current parent block
  he && // presence of a patch flag indicates this node needs patching on updates.
  // component nodes also should always be patched, because even if the
  // component doesn't need to update, it needs to persist the instance on to
  // the next vnode so that it can be properly unmounted later.
  (f.patchFlag > 0 || r & 6) && // the EVENTS flag is only for hydration and if it is the only flag, the
  // vnode should not be considered dynamic due to handler caching.
  f.patchFlag !== 32 && he.push(f), f;
}
const ke = process.env.NODE_ENV !== "production" ? lc : $r;
function $r(e, t = null, n = null, o = 0, s = null, r = !1) {
  if ((!e || e === Nl) && (process.env.NODE_ENV !== "production" && !e && y(`Invalid vnode type when creating vnode: ${e}.`), e = ge), Hn(e)) {
    const l = st(
      e,
      t,
      !0
      /* mergeRef: true */
    );
    return n && Po(l, n), qt > 0 && !r && he && (l.shapeFlag & 6 ? he[he.indexOf(e)] = l : he.push(l)), l.patchFlag = -2, l;
  }
  if (Fr(e) && (e = e.__vccOpts), t) {
    t = cc(t);
    let { class: l, style: f } = t;
    l && !q(l) && (t.class = An(l)), k(f) && (/* @__PURE__ */ En(f) && !T(f) && (f = J({}, f)), t.style = No(f));
  }
  const i = q(e) ? 1 : Sr(e) ? 128 : rl(e) ? 64 : k(e) ? 4 : $(e) ? 2 : 0;
  return process.env.NODE_ENV !== "production" && i & 4 && /* @__PURE__ */ En(e) && (e = /* @__PURE__ */ M(e), y(
    "Vue received a Component that was made a reactive object. This can lead to unnecessary performance overhead and should be avoided by marking the component with `markRaw` or using `shallowRef` instead of `ref`.",
    `
Component that was made reactive: `,
    e
  )), Bt(
    e,
    t,
    n,
    o,
    s,
    i,
    r,
    !0
  );
}
function cc(e) {
  return e ? /* @__PURE__ */ En(e) || Nr(e) ? J({}, e) : e : null;
}
function st(e, t, n = !1, o = !1) {
  const { props: s, ref: r, patchFlag: i, children: l, transition: f } = e, d = t ? fc(s || {}, t) : s, p = {
    __v_isVNode: !0,
    __v_skip: !0,
    type: e.type,
    props: d,
    key: d && Tr(d),
    ref: t && t.ref ? (
      // #2078 in the case of <component :is="vnode" ref="extra"/>
      // if the vnode itself already has a ref, cloneVNode will need to merge
      // the refs so the single vnode can be set on multiple refs
      n && r ? T(r) ? r.concat(gn(t)) : [r, gn(t)] : gn(t)
    ) : r,
    scopeId: e.scopeId,
    slotScopeIds: e.slotScopeIds,
    children: process.env.NODE_ENV !== "production" && i === -1 && T(l) ? l.map(Ar) : l,
    target: e.target,
    targetStart: e.targetStart,
    targetAnchor: e.targetAnchor,
    staticCount: e.staticCount,
    shapeFlag: e.shapeFlag,
    // if the vnode is cloned with extra props, we can no longer assume its
    // existing patch flag to be reliable and need to add the FULL_PROPS flag.
    // note: preserve flag for fragments since they use the flag for children
    // fast paths only.
    patchFlag: t && e.type !== _e ? i === -1 ? 16 : i | 16 : i,
    dynamicProps: e.dynamicProps,
    dynamicChildren: e.dynamicChildren,
    appContext: e.appContext,
    dirs: e.dirs,
    transition: f,
    // These should technically only be non-null on mounted VNodes. However,
    // they *should* be copied for kept-alive vnodes. So we just always copy
    // them since them being non-null during a mount doesn't affect the logic as
    // they will simply be overwritten.
    component: e.component,
    suspense: e.suspense,
    ssContent: e.ssContent && st(e.ssContent),
    ssFallback: e.ssFallback && st(e.ssFallback),
    placeholder: e.placeholder,
    el: e.el,
    anchor: e.anchor,
    ctx: e.ctx,
    ce: e.ce
  };
  return f && o && Co(
    p,
    f.clone(p)
  ), p;
}
function Ar(e) {
  const t = st(e);
  return T(e.children) && (t.children = e.children.map(Ar)), t;
}
function Ir(e = " ", t = 0) {
  return ke(Qt, null, e, t);
}
function Mt(e = "", t = !1) {
  return t ? (Ae(), ic(ge, null, e)) : ke(ge, null, e);
}
function Ee(e) {
  return e == null || typeof e == "boolean" ? ke(ge) : T(e) ? ke(
    _e,
    null,
    // #3666, avoid reference pollution when reusing vnode
    e.slice()
  ) : Hn(e) ? et(e) : ke(Qt, null, String(e));
}
function et(e) {
  return e.el === null && e.patchFlag !== -1 || e.memo ? e : st(e);
}
function Po(e, t) {
  let n = 0;
  const { shapeFlag: o } = e;
  if (t == null)
    t = null;
  else if (T(t))
    n = 16;
  else if (typeof t == "object")
    if (o & 65) {
      const s = t.default;
      s && (s._c && (s._d = !1), Po(e, s()), s._c && (s._d = !0));
      return;
    } else {
      n = 32;
      const s = t._;
      !s && !Nr(t) ? t._ctx = de : s === 3 && de && (de.slots._ === 1 ? t._ = 1 : (t._ = 2, e.patchFlag |= 1024));
    }
  else $(t) ? (t = { default: t, _ctx: de }, n = 32) : (t = String(t), o & 64 ? (n = 16, t = [Ir(t)]) : n = 8);
  e.children = t, e.shapeFlag |= n;
}
function fc(...e) {
  const t = {};
  for (let n = 0; n < e.length; n++) {
    const o = e[n];
    for (const s in o)
      if (s === "class")
        t.class !== o.class && (t.class = An([t.class, o.class]));
      else if (s === "style")
        t.style = No([t.style, o.style]);
      else if (Yt(s)) {
        const r = t[s], i = o[s];
        i && r !== i && !(T(r) && r.includes(i)) && (t[s] = r ? [].concat(r, i) : i);
      } else s !== "" && (t[s] = o[s]);
  }
  return t;
}
function $e(e, t, n, o = null) {
  je(e, t, 7, [
    n,
    o
  ]);
}
const uc = gr();
let ac = 0;
function pc(e, t, n) {
  const o = e.type, s = (t ? t.appContext : e.appContext) || uc, r = {
    uid: ac++,
    vnode: e,
    type: o,
    parent: t,
    appContext: s,
    root: null,
    // to be immediately set
    next: null,
    subTree: null,
    // will be set synchronously right after creation
    effect: null,
    update: null,
    // will be set synchronously right after creation
    job: null,
    scope: new ri(
      !0
      /* detached */
    ),
    render: null,
    proxy: null,
    exposed: null,
    exposeProxy: null,
    withProxy: null,
    provides: t ? t.provides : Object.create(s.provides),
    ids: t ? t.ids : ["", 0, 0],
    accessCache: null,
    renderCache: [],
    // local resolved assets
    components: null,
    directives: null,
    // resolved props and emits options
    propsOptions: yr(o, s),
    emitsOptions: mr(o, s),
    // emit
    emit: null,
    // to be set immediately
    emitted: null,
    // props default value
    propsDefaults: B,
    // inheritAttrs
    inheritAttrs: o.inheritAttrs,
    // state
    ctx: B,
    data: B,
    props: B,
    attrs: B,
    slots: B,
    refs: B,
    setupState: B,
    setupContext: null,
    // suspense related
    suspense: n,
    suspenseId: n ? n.pendingId : 0,
    asyncDep: null,
    asyncResolved: !1,
    // lifecycle hooks
    // not using enums here because it results in computed properties
    isMounted: !1,
    isUnmounted: !1,
    isDeactivated: !1,
    bc: null,
    c: null,
    bm: null,
    m: null,
    bu: null,
    u: null,
    um: null,
    bum: null,
    da: null,
    a: null,
    rtg: null,
    rtc: null,
    ec: null,
    sp: null
  };
  return process.env.NODE_ENV !== "production" ? r.ctx = yl(r) : r.ctx = { _: r }, r.root = t ? t.root : r, r.emit = Ml.bind(null, r), e.ce && e.ce(r), r;
}
let Y = null;
const Mr = () => Y || de;
let Sn, po;
{
  const e = zt(), t = (n, o) => {
    let s;
    return (s = e[n]) || (s = e[n] = []), s.push(o), (r) => {
      s.length > 1 ? s.forEach((i) => i(r)) : s[0](r);
    };
  };
  Sn = t(
    "__VUE_INSTANCE_SETTERS__",
    (n) => Y = n
  ), po = t(
    "__VUE_SSR_SETTERS__",
    (n) => Jt = n
  );
}
const en = (e) => {
  const t = Y;
  return Sn(e), e.scope.on(), () => {
    e.scope.off(), Sn(t);
  };
}, cs = () => {
  Y && Y.scope.off(), Sn(null);
}, dc = /* @__PURE__ */ qe("slot,component");
function ho(e, { isNativeTag: t }) {
  (dc(e) || t(e)) && y(
    "Do not use built-in or reserved HTML elements as component id: " + e
  );
}
function Pr(e) {
  return e.vnode.shapeFlag & 4;
}
let Jt = !1;
function hc(e, t = !1, n = !1) {
  t && po(t);
  const { props: o, children: s } = e.vnode, r = Pr(e);
  Ll(e, o, r, t), Xl(e, s, n || t);
  const i = r ? gc(e, t) : void 0;
  return t && po(!1), i;
}
function gc(e, t) {
  const n = e.type;
  if (process.env.NODE_ENV !== "production") {
    if (n.name && ho(n.name, e.appContext.config), n.components) {
      const s = Object.keys(n.components);
      for (let r = 0; r < s.length; r++)
        ho(s[r], e.appContext.config);
    }
    if (n.directives) {
      const s = Object.keys(n.directives);
      for (let r = 0; r < s.length; r++)
        ir(s[r]);
    }
    n.compilerOptions && mc() && y(
      '"compilerOptions" is only supported when using a build of Vue that includes the runtime compiler. Since you are using a runtime-only build, the options should be passed via your build tool config instead.'
    );
  }
  e.accessCache = /* @__PURE__ */ Object.create(null), e.proxy = new Proxy(e.ctx, pr), process.env.NODE_ENV !== "production" && Ol(e);
  const { setup: o } = n;
  if (o) {
    we();
    const s = e.setupContext = o.length > 1 ? vc(e) : null, r = en(e), i = wt(
      o,
      e,
      0,
      [
        process.env.NODE_ENV !== "production" ? /* @__PURE__ */ Pe(e.props) : e.props,
        s
      ]
    ), l = _o(i);
    if (xe(), r(), (l || e.sp) && !Ut(e) && fr(e), l) {
      if (i.then(cs, cs), t)
        return i.then((f) => {
          fs(e, f, t);
        }).catch((f) => {
          Xt(f, e, 0);
        });
      if (e.asyncDep = i, process.env.NODE_ENV !== "production" && !e.suspense) {
        const f = tn(e, n);
        y(
          `Component <${f}>: setup function returned a promise, but no <Suspense> boundary was found in the parent component tree. A component with async setup() must be nested in a <Suspense> in order to be rendered.`
        );
      }
    } else
      fs(e, i, t);
  } else
    Rr(e, t);
}
function fs(e, t, n) {
  $(t) ? e.type.__ssrInlineRender ? e.ssrRender = t : e.render = t : k(t) ? (process.env.NODE_ENV !== "production" && Hn(t) && y(
    "setup() should not return VNodes directly - return a render function instead."
  ), process.env.NODE_ENV !== "production" && (e.devtoolsRawSetupState = t), e.setupState = Ys(t), process.env.NODE_ENV !== "production" && Dl(e)) : process.env.NODE_ENV !== "production" && t !== void 0 && y(
    `setup() should return an object. Received: ${t === null ? "null" : typeof t}`
  ), Rr(e, n);
}
const mc = () => !0;
function Rr(e, t, n) {
  const o = e.type;
  e.render || (e.render = o.render || X);
  {
    const s = en(e);
    we();
    try {
      xl(e);
    } finally {
      xe(), s();
    }
  }
  process.env.NODE_ENV !== "production" && !o.render && e.render === X && !t && (o.template ? y(
    'Component provided template option but runtime compilation is not supported in this build of Vue. Configure your bundler to alias "vue" to "vue/dist/vue.esm-bundler.js".'
  ) : y("Component is missing template or render function: ", o));
}
const us = process.env.NODE_ENV !== "production" ? {
  get(e, t) {
    return xn(), z(e, "get", ""), e[t];
  },
  set() {
    return y("setupContext.attrs is readonly."), !1;
  },
  deleteProperty() {
    return y("setupContext.attrs is readonly."), !1;
  }
} : {
  get(e, t) {
    return z(e, "get", ""), e[t];
  }
};
function _c(e) {
  return new Proxy(e.slots, {
    get(t, n) {
      return z(e, "get", "$slots"), t[n];
    }
  });
}
function vc(e) {
  const t = (n) => {
    if (process.env.NODE_ENV !== "production" && (e.exposed && y("expose() should be called only once per setup()."), n != null)) {
      let o = typeof n;
      o === "object" && (T(n) ? o = "array" : /* @__PURE__ */ Z(n) && (o = "ref")), o !== "object" && y(
        `expose() should be passed a plain object, received ${o}.`
      );
    }
    e.exposed = n || {};
  };
  if (process.env.NODE_ENV !== "production") {
    let n, o;
    return Object.freeze({
      get attrs() {
        return n || (n = new Proxy(e.attrs, us));
      },
      get slots() {
        return o || (o = _c(e));
      },
      get emit() {
        return (s, ...r) => e.emit(s, ...r);
      },
      expose: t
    });
  } else
    return {
      attrs: new Proxy(e.attrs, us),
      slots: e.slots,
      emit: e.emit,
      expose: t
    };
}
function Ro(e) {
  return e.exposed ? e.exposeProxy || (e.exposeProxy = new Proxy(Ys(xi(e.exposed)), {
    get(t, n) {
      if (n in t)
        return t[n];
      if (n in ht)
        return ht[n](e);
    },
    has(t, n) {
      return n in t || n in ht;
    }
  })) : e.proxy;
}
const Ec = /(?:^|[-_])\w/g, Nc = (e) => e.replace(Ec, (t) => t.toUpperCase()).replace(/[-_]/g, "");
function jr(e, t = !0) {
  return $(e) ? e.displayName || e.name : e.name || t && e.__name;
}
function tn(e, t, n = !1) {
  let o = jr(t);
  if (!o && t.__file) {
    const s = t.__file.match(/([^/\\]+)\.\w+$/);
    s && (o = s[1]);
  }
  if (!o && e) {
    const s = (r) => {
      for (const i in r)
        if (r[i] === t)
          return i;
    };
    o = s(e.components) || e.parent && s(
      e.parent.type.components
    ) || s(e.appContext.components);
  }
  return o ? Nc(o) : n ? "App" : "Anonymous";
}
function Fr(e) {
  return $(e) && "__vccOpts" in e;
}
const Ue = (e, t) => {
  const n = /* @__PURE__ */ Ti(e, t, Jt);
  if (process.env.NODE_ENV !== "production") {
    const o = Mr();
    o && o.appContext.config.warnRecursiveComputed && (n._warnRecursive = !0);
  }
  return n;
};
function bc() {
  if (process.env.NODE_ENV === "production" || typeof window > "u")
    return;
  const e = { style: "color:#3ba776" }, t = { style: "color:#1677ff" }, n = { style: "color:#f5222d" }, o = { style: "color:#eb2f96" }, s = {
    __vue_custom_formatter: !0,
    header(a) {
      if (!k(a))
        return null;
      if (a.__isVue)
        return ["div", e, "VueInstance"];
      if (/* @__PURE__ */ Z(a)) {
        we();
        const g = a.value;
        return xe(), [
          "div",
          {},
          ["span", e, p(a)],
          "<",
          l(g),
          ">"
        ];
      } else {
        if (/* @__PURE__ */ nt(a))
          return [
            "div",
            {},
            ["span", e, /* @__PURE__ */ ue(a) ? "ShallowReactive" : "Reactive"],
            "<",
            l(a),
            `>${/* @__PURE__ */ Re(a) ? " (readonly)" : ""}`
          ];
        if (/* @__PURE__ */ Re(a))
          return [
            "div",
            {},
            ["span", e, /* @__PURE__ */ ue(a) ? "ShallowReadonly" : "Readonly"],
            "<",
            l(a),
            ">"
          ];
      }
      return null;
    },
    hasBody(a) {
      return a && a.__isVue;
    },
    body(a) {
      if (a && a.__isVue)
        return [
          "div",
          {},
          ...r(a.$)
        ];
    }
  };
  function r(a) {
    const g = [];
    a.type.props && a.props && g.push(i("props", /* @__PURE__ */ M(a.props))), a.setupState !== B && g.push(i("setup", a.setupState)), a.data !== B && g.push(i("data", /* @__PURE__ */ M(a.data)));
    const w = f(a, "computed");
    w && g.push(i("computed", w));
    const A = f(a, "inject");
    return A && g.push(i("injected", A)), g.push([
      "div",
      {},
      [
        "span",
        {
          style: o.style + ";opacity:0.66"
        },
        "$ (internal): "
      ],
      ["object", { object: a }]
    ]), g;
  }
  function i(a, g) {
    return g = J({}, g), Object.keys(g).length ? [
      "div",
      { style: "line-height:1.25em;margin-bottom:0.6em" },
      [
        "div",
        {
          style: "color:#476582"
        },
        a
      ],
      [
        "div",
        {
          style: "padding-left:1.25em"
        },
        ...Object.keys(g).map((w) => [
          "div",
          {},
          ["span", o, w + ": "],
          l(g[w], !1)
        ])
      ]
    ] : ["span", {}];
  }
  function l(a, g = !0) {
    return typeof a == "number" ? ["span", t, a] : typeof a == "string" ? ["span", n, JSON.stringify(a)] : typeof a == "boolean" ? ["span", o, a] : k(a) ? ["object", { object: g ? /* @__PURE__ */ M(a) : a }] : ["span", n, String(a)];
  }
  function f(a, g) {
    const w = a.type;
    if ($(w))
      return;
    const A = {};
    for (const V in a.ctx)
      d(w, V, g) && (A[V] = a.ctx[V]);
    return A;
  }
  function d(a, g, w) {
    const A = a[w];
    if (T(A) && A.includes(g) || k(A) && g in A || a.extends && d(a.extends, g, w) || a.mixins && a.mixins.some((V) => d(V, g, w)))
      return !0;
  }
  function p(a) {
    return /* @__PURE__ */ ue(a) ? "ShallowRef" : a.effect ? "ComputedRef" : "Ref";
  }
  window.devtoolsFormatters ? window.devtoolsFormatters.push(s) : window.devtoolsFormatters = [s];
}
const as = "3.5.27", Ke = process.env.NODE_ENV !== "production" ? y : X;
process.env.NODE_ENV;
process.env.NODE_ENV;
/**
* @vue/runtime-dom v3.5.27
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
let go;
const ps = typeof window < "u" && window.trustedTypes;
if (ps)
  try {
    go = /* @__PURE__ */ ps.createPolicy("vue", {
      createHTML: (e) => e
    });
  } catch (e) {
    process.env.NODE_ENV !== "production" && Ke(`Error creating trusted types policy: ${e}`);
  }
const Hr = go ? (e) => go.createHTML(e) : (e) => e, yc = "http://www.w3.org/2000/svg", Oc = "http://www.w3.org/1998/Math/MathML", We = typeof document < "u" ? document : null, ds = We && /* @__PURE__ */ We.createElement("template"), Dc = {
  insert: (e, t, n) => {
    t.insertBefore(e, n || null);
  },
  remove: (e) => {
    const t = e.parentNode;
    t && t.removeChild(e);
  },
  createElement: (e, t, n, o) => {
    const s = t === "svg" ? We.createElementNS(yc, e) : t === "mathml" ? We.createElementNS(Oc, e) : n ? We.createElement(e, { is: n }) : We.createElement(e);
    return e === "select" && o && o.multiple != null && s.setAttribute("multiple", o.multiple), s;
  },
  createText: (e) => We.createTextNode(e),
  createComment: (e) => We.createComment(e),
  setText: (e, t) => {
    e.nodeValue = t;
  },
  setElementText: (e, t) => {
    e.textContent = t;
  },
  parentNode: (e) => e.parentNode,
  nextSibling: (e) => e.nextSibling,
  querySelector: (e) => We.querySelector(e),
  setScopeId(e, t) {
    e.setAttribute(t, "");
  },
  // __UNSAFE__
  // Reason: innerHTML.
  // Static content here can only come from compiled templates.
  // As long as the user only uses trusted templates, this is safe.
  insertStaticContent(e, t, n, o, s, r) {
    const i = n ? n.previousSibling : t.lastChild;
    if (s && (s === r || s.nextSibling))
      for (; t.insertBefore(s.cloneNode(!0), n), !(s === r || !(s = s.nextSibling)); )
        ;
    else {
      ds.innerHTML = Hr(
        o === "svg" ? `<svg>${e}</svg>` : o === "mathml" ? `<math>${e}</math>` : e
      );
      const l = ds.content;
      if (o === "svg" || o === "mathml") {
        const f = l.firstChild;
        for (; f.firstChild; )
          l.appendChild(f.firstChild);
        l.removeChild(f);
      }
      t.insertBefore(l, n);
    }
    return [
      // first
      i ? i.nextSibling : t.firstChild,
      // last
      n ? n.previousSibling : t.lastChild
    ];
  }
}, wc = /* @__PURE__ */ Symbol("_vtc");
function xc(e, t, n) {
  const o = e[wc];
  o && (t = (t ? [t, ...o] : [...o]).join(" ")), t == null ? e.removeAttribute("class") : n ? e.setAttribute("class", t) : e.className = t;
}
const hs = /* @__PURE__ */ Symbol("_vod"), Vc = /* @__PURE__ */ Symbol("_vsh"), Sc = /* @__PURE__ */ Symbol(process.env.NODE_ENV !== "production" ? "CSS_VAR_TEXT" : ""), Cc = /(?:^|;)\s*display\s*:/;
function Tc(e, t, n) {
  const o = e.style, s = q(n);
  let r = !1;
  if (n && !s) {
    if (t)
      if (q(t))
        for (const i of t.split(";")) {
          const l = i.slice(0, i.indexOf(":")).trim();
          n[l] == null && mn(o, l, "");
        }
      else
        for (const i in t)
          n[i] == null && mn(o, i, "");
    for (const i in n)
      i === "display" && (r = !0), mn(o, i, n[i]);
  } else if (s) {
    if (t !== n) {
      const i = o[Sc];
      i && (n += ";" + i), o.cssText = n, r = Cc.test(n);
    }
  } else t && e.removeAttribute("style");
  hs in e && (e[hs] = r ? o.display : "", e[Vc] && (o.display = "none"));
}
const $c = /[^\\];\s*$/, gs = /\s*!important$/;
function mn(e, t, n) {
  if (T(n))
    n.forEach((o) => mn(e, t, o));
  else if (n == null && (n = ""), process.env.NODE_ENV !== "production" && $c.test(n) && Ke(
    `Unexpected semicolon at the end of '${t}' style value: '${n}'`
  ), t.startsWith("--"))
    e.setProperty(t, n);
  else {
    const o = Ac(e, t);
    gs.test(n) ? e.setProperty(
      ot(o),
      n.replace(gs, ""),
      "important"
    ) : e[o] = n;
  }
}
const ms = ["Webkit", "Moz", "ms"], Zn = {};
function Ac(e, t) {
  const n = Zn[t];
  if (n)
    return n;
  let o = ye(t);
  if (o !== "filter" && o in e)
    return Zn[t] = o;
  o = $n(o);
  for (let s = 0; s < ms.length; s++) {
    const r = ms[s] + o;
    if (r in e)
      return Zn[t] = r;
  }
  return t;
}
const _s = "http://www.w3.org/1999/xlink";
function vs(e, t, n, o, s, r = si(t)) {
  o && t.startsWith("xlink:") ? n == null ? e.removeAttributeNS(_s, t.slice(6, t.length)) : e.setAttributeNS(_s, t, n) : n == null || r && !Cs(n) ? e.removeAttribute(t) : e.setAttribute(
    t,
    r ? "" : rt(n) ? String(n) : n
  );
}
function Es(e, t, n, o, s) {
  if (t === "innerHTML" || t === "textContent") {
    n != null && (e[t] = t === "innerHTML" ? Hr(n) : n);
    return;
  }
  const r = e.tagName;
  if (t === "value" && r !== "PROGRESS" && // custom elements may use _value internally
  !r.includes("-")) {
    const l = r === "OPTION" ? e.getAttribute("value") || "" : e.value, f = n == null ? (
      // #11647: value should be set as empty string for null and undefined,
      // but <input type="checkbox"> should be set as 'on'.
      e.type === "checkbox" ? "on" : ""
    ) : String(n);
    (l !== f || !("_value" in e)) && (e.value = f), n == null && e.removeAttribute(t), e._value = n;
    return;
  }
  let i = !1;
  if (n === "" || n == null) {
    const l = typeof e[t];
    l === "boolean" ? n = Cs(n) : n == null && l === "string" ? (n = "", i = !0) : l === "number" && (n = 0, i = !0);
  }
  try {
    e[t] = n;
  } catch (l) {
    process.env.NODE_ENV !== "production" && !i && Ke(
      `Failed setting prop "${t}" on <${r.toLowerCase()}>: value ${n} is invalid.`,
      l
    );
  }
  i && e.removeAttribute(s || t);
}
function Ic(e, t, n, o) {
  e.addEventListener(t, n, o);
}
function Mc(e, t, n, o) {
  e.removeEventListener(t, n, o);
}
const Ns = /* @__PURE__ */ Symbol("_vei");
function Pc(e, t, n, o, s = null) {
  const r = e[Ns] || (e[Ns] = {}), i = r[t];
  if (o && i)
    i.value = process.env.NODE_ENV !== "production" ? ys(o, t) : o;
  else {
    const [l, f] = Rc(t);
    if (o) {
      const d = r[t] = Hc(
        process.env.NODE_ENV !== "production" ? ys(o, t) : o,
        s
      );
      Ic(e, l, d, f);
    } else i && (Mc(e, l, i, f), r[t] = void 0);
  }
}
const bs = /(?:Once|Passive|Capture)$/;
function Rc(e) {
  let t;
  if (bs.test(e)) {
    t = {};
    let o;
    for (; o = e.match(bs); )
      e = e.slice(0, e.length - o[0].length), t[o[0].toLowerCase()] = !0;
  }
  return [e[2] === ":" ? e.slice(3) : ot(e.slice(2)), t];
}
let Qn = 0;
const jc = /* @__PURE__ */ Promise.resolve(), Fc = () => Qn || (jc.then(() => Qn = 0), Qn = Date.now());
function Hc(e, t) {
  const n = (o) => {
    if (!o._vts)
      o._vts = Date.now();
    else if (o._vts <= n.attached)
      return;
    je(
      Lc(o, n.value),
      t,
      5,
      [o]
    );
  };
  return n.value = e, n.attached = Fc(), n;
}
function ys(e, t) {
  return $(e) || T(e) ? e : (Ke(
    `Wrong type passed as event handler to ${t} - did you forget @ or : in front of your prop?
Expected function or array of functions, received type ${typeof e}.`
  ), X);
}
function Lc(e, t) {
  if (T(t)) {
    const n = e.stopImmediatePropagation;
    return e.stopImmediatePropagation = () => {
      n.call(e), e._stopped = !0;
    }, t.map(
      (o) => (s) => !s._stopped && o && o(s)
    );
  } else
    return t;
}
const Os = (e) => e.charCodeAt(0) === 111 && e.charCodeAt(1) === 110 && // lowercase letter
e.charCodeAt(2) > 96 && e.charCodeAt(2) < 123, Uc = (e, t, n, o, s, r) => {
  const i = s === "svg";
  t === "class" ? xc(e, o, i) : t === "style" ? Tc(e, n, o) : Yt(t) ? _n(t) || Pc(e, t, n, o, r) : (t[0] === "." ? (t = t.slice(1), !0) : t[0] === "^" ? (t = t.slice(1), !1) : Wc(e, t, o, i)) ? (Es(e, t, o), !e.tagName.includes("-") && (t === "value" || t === "checked" || t === "selected") && vs(e, t, o, i, r, t !== "value")) : /* #11081 force set props for possible async custom element */ e._isVueCE && (/[A-Z]/.test(t) || !q(o)) ? Es(e, ye(t), o, r, t) : (t === "true-value" ? e._trueValue = o : t === "false-value" && (e._falseValue = o), vs(e, t, o, i));
};
function Wc(e, t, n, o) {
  if (o)
    return !!(t === "innerHTML" || t === "textContent" || t in e && Os(t) && $(n));
  if (t === "spellcheck" || t === "draggable" || t === "translate" || t === "autocorrect" || t === "sandbox" && e.tagName === "IFRAME" || t === "form" || t === "list" && e.tagName === "INPUT" || t === "type" && e.tagName === "TEXTAREA")
    return !1;
  if (t === "width" || t === "height") {
    const s = e.tagName;
    if (s === "IMG" || s === "VIDEO" || s === "CANVAS" || s === "SOURCE")
      return !1;
  }
  return Os(t) && q(n) ? !1 : t in e;
}
const Bc = /* @__PURE__ */ J({ patchProp: Uc }, Dc);
let Ds;
function kc() {
  return Ds || (Ds = ec(Bc));
}
const Kc = (...e) => {
  const t = kc().createApp(...e);
  process.env.NODE_ENV !== "production" && (qc(t), Jc(t));
  const { mount: n } = t;
  return t.mount = (o) => {
    const s = Yc(o);
    if (!s) return;
    const r = t._component;
    !$(r) && !r.render && !r.template && (r.template = s.innerHTML), s.nodeType === 1 && (s.textContent = "");
    const i = n(s, !1, Gc(s));
    return s instanceof Element && (s.removeAttribute("v-cloak"), s.setAttribute("data-v-app", "")), i;
  }, t;
};
function Gc(e) {
  if (e instanceof SVGElement)
    return "svg";
  if (typeof MathMLElement == "function" && e instanceof MathMLElement)
    return "mathml";
}
function qc(e) {
  Object.defineProperty(e.config, "isNativeTag", {
    value: (t) => ei(t) || ti(t) || ni(t),
    writable: !1
  });
}
function Jc(e) {
  {
    const t = e.config.isCustomElement;
    Object.defineProperty(e.config, "isCustomElement", {
      get() {
        return t;
      },
      set() {
        Ke(
          "The `isCustomElement` config option is deprecated. Use `compilerOptions.isCustomElement` instead."
        );
      }
    });
    const n = e.config.compilerOptions, o = 'The `compilerOptions` config option is only respected when using a build of Vue.js that includes the runtime compiler (aka "full build"). Since you are using the runtime-only build, `compilerOptions` must be passed to `@vue/compiler-dom` in the build setup instead.\n- For vue-loader: pass it via vue-loader\'s `compilerOptions` loader option.\n- For vue-cli: see https://cli.vuejs.org/guide/webpack.html#modifying-options-of-a-loader\n- For vite: pass it via @vitejs/plugin-vue options. See https://github.com/vitejs/vite-plugin-vue/tree/main/packages/plugin-vue#example-for-passing-options-to-vuecompiler-sfc';
    Object.defineProperty(e.config, "compilerOptions", {
      get() {
        return Ke(o), n;
      },
      set() {
        Ke(o);
      }
    });
  }
}
function Yc(e) {
  if (q(e)) {
    const t = document.querySelector(e);
    return process.env.NODE_ENV !== "production" && !t && Ke(
      `Failed to mount app: mount target selector "${e}" returned null.`
    ), t;
  }
  return process.env.NODE_ENV !== "production" && window.ShadowRoot && e instanceof window.ShadowRoot && e.mode === "closed" && Ke(
    'mounting on a ShadowRoot with `{mode: "closed"}` may lead to unpredictable bugs'
  ), e;
}
/**
* vue v3.5.27
* (c) 2018-present Yuxi (Evan) You and Vue contributors
* @license MIT
**/
function zc() {
  bc();
}
process.env.NODE_ENV !== "production" && zc();
const Xc = (e, t = {}) => {
  if (!e) return "N/A";
  const n = e < 1e10 ? e * 1e3 : e, o = t.locale || "en-US";
  return new Date(n).toLocaleDateString(o, {
    dateStyle: t.style || "medium"
  });
}, Zc = ["data-asset-id"], Qc = { class: "mjr-thumb" }, ef = ["src"], tf = ["src"], nf = {
  key: 2,
  class: "mjr-rating-badge"
}, of = {
  key: 3,
  class: "mjr-file-badge"
}, sf = {
  key: 0,
  class: "mjr-card-info"
}, rf = ["title"], lf = { class: "mjr-card-meta" }, cf = {
  key: 0,
  class: "mjr-workflow-dot",
  title: "Has Workflow"
}, ff = /* @__PURE__ */ ll({
  __name: "Card",
  props: {
    asset: {},
    isSelected: { type: Boolean },
    showDetails: { type: Boolean }
  },
  emits: ["select", "open"],
  setup(e) {
    const t = e, n = Ue(() => t.asset.type === "image"), o = Ue(() => t.asset.type === "video"), s = Ue(() => `/view?filename=${encodeURIComponent(t.asset.filename)}&type=input`), r = Ue(() => t.asset.url), i = Ue(() => Math.min(5, Math.max(0, t.asset.rating || 0))), l = Ue(() => {
      var a;
      return ((a = t.asset.filename.split(".").pop()) == null ? void 0 : a.toUpperCase()) || "";
    }), f = Ue(() => !1), d = Ue(() => Xc(t.asset.mtime));
    return (p, a) => (Ae(), Le("div", {
      class: An(["mjr-asset-card", { "is-selected": e.isSelected, "has-collision": f.value }]),
      onClick: a[0] || (a[0] = (g) => p.$emit("select", e.asset)),
      onDblclick: a[1] || (a[1] = (g) => p.$emit("open", e.asset)),
      "data-asset-id": e.asset.id
    }, [
      Bt("div", Qc, [
        n.value ? (Ae(), Le("img", {
          key: 0,
          src: s.value,
          loading: "lazy",
          alt: "Asset thumbnail"
        }, null, 8, ef)) : o.value ? (Ae(), Le("video", {
          key: 1,
          src: r.value,
          muted: "",
          loop: "",
          playsinline: "",
          class: "mjr-thumb-media"
        }, null, 8, tf)) : Mt("", !0),
        i.value > 0 ? (Ae(), Le("div", nf, [
          (Ae(!0), Le(_e, null, bl(i.value, (g) => (Ae(), Le("span", {
            key: g,
            class: "star"
          }, "★"))), 128))
        ])) : Mt("", !0),
        l.value ? (Ae(), Le("div", of, cn(l.value), 1)) : Mt("", !0)
      ]),
      e.showDetails ? (Ae(), Le("div", sf, [
        Bt("div", {
          class: "mjr-card-filename",
          title: e.asset.filename
        }, cn(e.asset.filename), 9, rf),
        Bt("div", lf, [
          Ir(cn(d.value) + " ", 1),
          p.hasWorkflow ? (Ae(), Le("span", cf)) : Mt("", !0)
        ])
      ])) : Mt("", !0)
    ], 42, Zc));
  }
}), uf = (e, t) => {
  const n = e.__vccOpts || e;
  for (const [o, s] of t)
    n[o] = s;
  return n;
}, af = /* @__PURE__ */ uf(ff, [["__scopeId", "data-v-f142ba45"]]);
function df(e, t) {
  const n = Kc(af, t);
  return n.mount(e), n;
}
export {
  af as Card,
  df as mountCard
};
