//# allFunctionsCalledOnLoad
function e(e){let t=e.tagName===`AUDIO`||e.tagName===`VIDEO`,n=e;if(t){try{n.pause()}catch(e){}n.srcObject=null,n.src=``}if(!t&&!e.isConnected)e.src=``;else if(e.removeAttribute(`src`),t)try{n.load()}catch(e){}}export{e as t};
//# sourceMappingURL=clearMediaElementSource-ClXua_74.js.map