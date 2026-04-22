import{c as p,J as a}from"./index-DukvRfm3.js";/**
 * @license lucide-react v0.395.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const i=p("Ban",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m4.9 4.9 14.2 14.2",key:"1m5liu"}]]);/**
 * @license lucide-react v0.395.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const d=p("CalendarClock",[["path",{d:"M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5",key:"1osxxc"}],["path",{d:"M16 2v4",key:"4m81vk"}],["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M3 10h5",key:"r794hk"}],["path",{d:"M17.5 17.5 16 16.3V14",key:"akvzfd"}],["circle",{cx:"16",cy:"16",r:"6",key:"qoo3c4"}]]);/**
 * @license lucide-react v0.395.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $=p("Calendar",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}]]),y=(t,e)=>a.get(`/properties/${t}/tenants`,{params:e}),h=(t,e)=>a.get(`/properties/${t}/tenants/${e}`),l=(t,e)=>a.get(`/properties/${t}/tenants/search`,{params:e}),k=(t,e)=>a.post(`/properties/${t}/tenants`,e),u=(t,e,s)=>a.put(`/properties/${t}/tenants/${e}`,s),v=(t,e)=>a.delete(`/properties/${t}/tenants/${e}`),m=(t,e,s,o,r=null)=>{const n={depositPaid:s};return s&&o?(n.depositBalance=o,n.depositStatus="held",r&&(n.depositPaidAt=r)):s||(n.depositStatus="pending",n.depositBalance=0,n.depositPaidAt=null),a.put(`/properties/${t}/tenants/${e}`,n)},g=(t,e)=>a.get(`/properties/${t}/tenants/${e}/rents`),f=(t,e)=>a.post(`/properties/${t}/tenants/${e}/advance/apply`),T=(t,e)=>a.post(`/properties/${t}/tenants/${e}/advance/refund`),M=(t,e,s={})=>a.post(`/properties/${t}/tenants/${e}/deposit/adjust`,s),x=(t,e)=>a.post(`/properties/${t}/tenants/${e}/deposit/refund`),C=(t,e)=>a.get(`/properties/${t}/tenants/${e}/profile`),P=(t,e,s)=>a.post(`/properties/${t}/tenants/${e}/vacate-with-payment`,s);export{i as B,$ as C,M as a,C as b,h as c,f as d,x as e,v as f,g,y as h,k as i,d as j,m,T as r,l as s,u,P as v};
