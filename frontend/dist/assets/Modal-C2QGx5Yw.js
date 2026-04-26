import{c as i,r as m,Q as p,j as e,X as u}from"./index-5ZD0iFcU.js";/**
 * @license lucide-react v0.395.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const h=i("RotateCcw",[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]),v=({title:a,onClose:s,children:l,size:r="md",disableBackdropClose:d=!1,bodyClassName:o="overflow-y-auto px-5 py-5",zIndex:c="z-50"})=>{m.useEffect(()=>{const t=x=>x.key==="Escape"&&s();return document.addEventListener("keydown",t),document.body.style.overflow="hidden",()=>{document.removeEventListener("keydown",t),document.body.style.overflow=""}},[s]);const n={sm:"max-w-sm",md:"max-w-lg",lg:"max-w-2xl",xl:"max-w-4xl"}[r]??"max-w-lg";return p.createPortal(e.jsxs("div",{className:`fixed inset-0 ${c} flex items-end sm:items-center justify-center p-0 sm:p-4`,children:[e.jsx("div",{className:"absolute inset-0 animate-fadeIn",style:{background:"rgba(15,23,42,0.45)",backdropFilter:"blur(2px)"},onClick:d?void 0:s}),e.jsxs("div",{className:`
          relative w-full ${n}
          animate-scaleIn
          rounded-t-2xl sm:rounded-2xl
          max-h-[92vh] flex flex-col
          bg-white
        `,style:{border:"1px solid #E2E8F0",boxShadow:"0 8px 32px rgba(0,0,0,0.10), 0 2px 8px rgba(0,0,0,0.06)"},children:[a&&e.jsxs("div",{className:"flex shrink-0 items-center justify-between px-5 py-4 border-b border-slate-100",children:[e.jsxs("div",{className:"flex items-center gap-2.5",children:[e.jsx("div",{className:"h-1.5 w-1.5 rounded-full bg-primary-500"}),e.jsx("h2",{className:"text-[15px] font-semibold text-slate-800",children:a})]}),e.jsx("button",{onClick:s,className:"rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors active:scale-95","aria-label":"Close",children:e.jsx(u,{size:17})})]}),e.jsx("div",{className:o,children:l})]})]}),document.body)};export{v as M,h as R};
