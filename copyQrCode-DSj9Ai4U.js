//# allFunctionsCalledOnLoad
import{i as e,r as t}from"./clipboard-dTSG_jtT.js";async function n({blob:n,url:r}){if(n)try{return await e({"image/png":n}),`image`}catch(e){console.error(`QR code image copy failed`,e)}try{return await t(r),`link`}catch(e){return console.error(`QR code link copy failed`,e),`failed`}}export{n as t};
//# sourceMappingURL=copyQrCode-DSj9Ai4U.js.map