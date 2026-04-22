import{c as r,r as x,a1 as y,j as e,X as m}from"./index-DukvRfm3.js";/**
 * @license lucide-react v0.395.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=r("Copy",[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]);/**
 * @license lucide-react v0.395.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p=r("Download",[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"7 10 12 15 17 10",key:"2ggqvy"}],["line",{x1:"12",x2:"12",y1:"15",y2:"3",key:"1vk2je"}]]),b=({title:o,subtitle:s,onClose:t,children:l,width:i="max-w-lg",closeOnBackdrop:n=!0,bodyClassName:c="flex-1 overflow-y-auto flex flex-col"})=>(x.useEffect(()=>{const a=d=>d.key==="Escape"&&t();return document.addEventListener("keydown",a),document.body.style.overflow="hidden",()=>{document.removeEventListener("keydown",a),document.body.style.overflow=""}},[t]),y.createPortal(e.jsxs("div",{className:"fixed inset-0 z-[60] flex justify-end",children:[e.jsx("div",{className:"absolute inset-0 animate-fadeIn",style:{background:"rgba(15,23,42,0.45)",backdropFilter:"blur(2px)"},onClick:n?t:void 0}),e.jsxs("div",{className:`relative flex h-full w-full flex-col ${i} bg-white`,style:{borderLeft:"1px solid #E2E8F0",boxShadow:"-8px 0 24px rgba(0,0,0,0.08)",animation:"slideInDrawer 0.25s cubic-bezier(0.16, 1, 0.3, 1) both"},children:[e.jsxs("div",{className:"flex shrink-0 items-start justify-between px-5 sm:px-6 py-3 border-b border-slate-100",children:[e.jsxs("div",{children:[e.jsx("h2",{className:"text-base font-semibold text-slate-800 tracking-tight",children:o}),s&&e.jsx("p",{className:"mt-0.5 text-sm text-slate-400",children:s})]}),e.jsx("button",{onClick:t,className:"rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors active:scale-95",children:e.jsx(m,{size:18})})]}),e.jsx("div",{className:c,children:l})]}),e.jsx("style",{children:`
        @keyframes slideInDrawer {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `})]}),document.body));export{f as C,p as D,b as a};
