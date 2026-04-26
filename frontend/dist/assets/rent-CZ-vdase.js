import{c as o,y as s}from"./index-5ZD0iFcU.js";/**
 * @license lucide-react v0.395.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const d=o("Ban",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m4.9 4.9 14.2 14.2",key:"1m5liu"}]]);/**
 * @license lucide-react v0.395.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=o("CalendarClock",[["path",{d:"M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5",key:"1osxxc"}],["path",{d:"M16 2v4",key:"4m81vk"}],["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M3 10h5",key:"r794hk"}],["path",{d:"M17.5 17.5 16 16.3V14",key:"akvzfd"}],["circle",{cx:"16",cy:"16",r:"6",key:"qoo3c4"}]]);/**
 * @license lucide-react v0.395.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=o("Calendar",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}]]),h=(t,e)=>s.get(`/properties/${t}/tenants`,{params:e}),l=(t,e)=>s.get(`/properties/${t}/tenants/${e}`),g=(t,e)=>s.get(`/properties/${t}/tenants/search`,{params:e}),k=(t,e)=>s.post(`/properties/${t}/tenants`,e),u=(t,e,a)=>s.put(`/properties/${t}/tenants/${e}`,a),m=(t,e)=>s.delete(`/properties/${t}/tenants/${e}`),v=(t,e,a,p,c=null)=>{const n={depositPaid:a};return a&&p?(n.depositBalance=p,n.depositStatus="held",c&&(n.depositPaidAt=c)):a||(n.depositStatus="pending",n.depositBalance=0,n.depositPaidAt=null),s.put(`/properties/${t}/tenants/${e}`,n)},f=(t,e)=>s.get(`/properties/${t}/tenants/${e}/rents`),T=(t,e)=>s.post(`/properties/${t}/tenants/${e}/advance/apply`),M=(t,e)=>s.post(`/properties/${t}/tenants/${e}/advance/refund`),C=(t,e,a={})=>s.post(`/properties/${t}/tenants/${e}/deposit/adjust`,a),P=(t,e)=>s.post(`/properties/${t}/tenants/${e}/deposit/refund`),x=(t,e)=>s.get(`/properties/${t}/tenants/${e}/profile`),A=(t,e,a)=>s.post(`/properties/${t}/tenants/${e}/vacate-with-payment`,a),r=["cash","upi","bank_transfer","cheque"],B=t=>{if(!t)return r;try{const e=JSON.parse(localStorage.getItem(`pm_${t}`));return Array.isArray(e)&&e.length>0?e:r}catch{return r}},S=(t,e)=>s.get(`/properties/${t}/rents`,{params:e}),b=(t,e)=>s.post(`/properties/${t}/rents/generate`,e),D=(t,e)=>s.post(`/properties/${t}/rents/payments`,e),L=(t,e,a)=>s.get(`/properties/${t}/rents/tenants/${e}/ledger`,{params:a}),j=(t,e,a)=>s.post(`/properties/${t}/rents/tenants/${e}/charge`,a),q=(t,e,a)=>s.post(`/properties/${t}/rents/payments/${e}/reverse`,a);export{d as B,y as C,S as a,L as b,f as c,j as d,C as e,q as f,b as g,x as h,l as i,T as j,M as k,B as l,P as m,m as n,h as o,k as p,v as q,D as r,g as s,$ as t,u,A as v};
