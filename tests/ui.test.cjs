// A real browser exercises the shipped extension against a small ComfyUI API fixture.
// Run with NODE_PATH pointing to a directory containing playwright.
const { chromium } = require("playwright");
const http = require("node:http"), fs = require("node:fs"), path = require("node:path");
const assert = require("node:assert/strict");
const base = path.resolve(__dirname, "..");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#d8cbb3"/><circle cx="285" cy="80" r="35" fill="#de8b55"/><path d="M0 220 L125 95 L250 235 L325 160 L400 250 V300 H0Z" fill="#7a8e88"/><path d="M0 265 Q180 200 400 280 V300 H0Z" fill="#415e62"/><text x="24" y="36" fill="#334749" font-family="sans-serif" font-size="18">SOURCE 400 × 300</text></svg>`;
const appMock = `export const app={registerExtension(e){this.extension=e},graph:{links:{1:{origin_id:1}},change(){},getNodeById(id){return id===1?{id:1,type:'LoadImage',widgets:[{name:'image',value:'sample.svg'}]}:null}}};`;
const server = http.createServer((req,res)=>{
    const url = new URL(req.url,"http://localhost"), name = url.pathname;
    res.setHeader("Cache-Control","no-store");
    if(name==="/scripts/app.js"){res.setHeader("Content-Type","text/javascript");return res.end(appMock)}
    if(name==="/scripts/api.js"){res.setHeader("Content-Type","text/javascript");return res.end(`export const api={apiURL:path=>path};`)}
    if(name==="/view"){res.setHeader("Content-Type","image/svg+xml");return res.end(svg)}
    const target = path.resolve(base, "."+name);
    if(!target.startsWith(base+path.sep)){res.statusCode=403;return res.end()}
    fs.readFile(target,(err,data)=>{if(err){res.statusCode=404;return res.end()}res.setHeader("Content-Type",name.endsWith(".html")?"text/html":"text/javascript");res.end(data)});
});

(async()=>{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    let browser;
    try {
        browser=await chromium.launch({headless:true,...(process.env.VC_BROWSER_PATH?{executablePath:process.env.VC_BROWSER_PATH}:{})});
        const page=await browser.newPage({viewport:{width:1000,height:850},deviceScaleFactor:1});
        const errors=[];page.on("pageerror",e=>errors.push(e.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/tests/ui_harness.html`);
        await page.waitForFunction(()=>window.node?.visualCanvasEditor.image);
        const raw=()=>page.evaluate(()=>node.widgets[0].value);
        const state=async()=>JSON.parse(await raw());
        await page.getByLabel("画布比例").selectOption("16:9");
        const initial=(await state()).draft.rect;
        assert.equal(initial.width,534);assert.equal(initial.height,300);
        // Real pointer events at the corner: maintain aspect ratio.
        let corner=await page.evaluate(()=>{const e=node.visualCanvasEditor;const [,x,y]=e.handles().find(h=>h[0]==='se');const b=e.canvas.getBoundingClientRect();return {x:b.left+x,y:b.top+y}});
        await page.mouse.move(corner.x,corner.y);await page.mouse.down();await page.mouse.move(corner.x+65,corner.y+36,{steps:8});await page.mouse.up();
        const afterCorner=(await state()).draft.rect;
        assert.ok(afterCorner.width>initial.width);
        assert.ok(Math.abs(afterCorner.width-afterCorner.height*initial.width/initial.height)<=2);
        // Side handles freely change ratio, unlike corner handles.
        let edge=await page.evaluate(()=>{const e=node.visualCanvasEditor;const [,x,y]=e.handles().find(h=>h[0]==='e');const b=e.canvas.getBoundingClientRect();return {x:b.left+x,y:b.top+y}});
        await page.mouse.move(edge.x,edge.y);await page.mouse.down();await page.mouse.move(edge.x+40,edge.y,{steps:6});await page.mouse.up();
        const afterEdge=(await state()).draft.rect;
        assert.equal(afterEdge.height,afterCorner.height);assert.ok(afterEdge.width>afterCorner.width);
        // The graph zooms DOM widgets with CSS transforms; pointer mapping must still work.
        await page.evaluate(()=>{document.querySelector('.node').style.transform='scale(.8)';document.querySelector('.node').style.transformOrigin='top center'});
        edge=await page.evaluate(()=>{const e=node.visualCanvasEditor;const [,x,y]=e.handles().find(h=>h[0]==='w');const b=e.canvas.getBoundingClientRect();return {x:b.left+x*b.width/e.canvas.clientWidth,y:b.top+y*b.height/e.canvas.clientHeight}});
        await page.mouse.move(edge.x,edge.y);await page.mouse.down();await page.mouse.move(edge.x-30,edge.y,{steps:5});await page.mouse.up();
        const afterScaledEdge=(await state()).draft.rect;
        assert.ok(afterScaledEdge.width>afterEdge.width);assert.equal(afterScaledEdge.height,afterEdge.height);
        await page.evaluate(()=>document.querySelector('.node').style.transform='');
        await page.getByLabel("十六进制颜色").fill("#26344a");await page.getByLabel("十六进制颜色").press("Tab");
        await page.getByRole("button",{name:"✓ 确认",exact:true}).click();
        const first=await raw();assert.equal((await state()).locked.color,"#26344a");
        assert.ok(await page.getByLabel("画布比例").isDisabled());
        assert.ok(await page.getByRole("button",{name:"✓ 确认",exact:true}).isDisabled());
        corner=await page.evaluate(()=>{const e=node.visualCanvasEditor;const [,x,y]=e.handles().find(h=>h[0]==='se');const b=e.canvas.getBoundingClientRect();return {x:b.left+x,y:b.top+y}});
        await page.mouse.move(corner.x,corner.y);await page.mouse.down();await page.mouse.move(corner.x+60,corner.y+50,{steps:5});await page.mouse.up();
        assert.equal(await raw(),first);
        // Reload source and attempt programmatic edits while locked.
        await page.getByRole("button",{name:"刷新原图",exact:true}).click();
        await page.waitForFunction(()=>node.visualCanvasEditor.image);
        await page.evaluate(()=>node.visualCanvasEditor.model.edit({color:'#ff0000'}));
        assert.equal(await raw(),first);
        // Restore saved workflow, then cancel / reconfirm using the actual UI.
        await page.evaluate(()=>node.onConfigure());assert.equal(await raw(),first);
        await page.getByRole("button",{name:"取消",exact:true}).click();
        assert.equal((await state()).locked,null);
        await page.getByLabel("画布比例").selectOption("1:1");
        await page.getByRole("button",{name:"✓ 确认",exact:true}).click();
        assert.equal((await state()).locked.rect.width,400);assert.equal((await state()).locked.rect.height,400);
        assert.notEqual(await raw(),first);
        // Screenshot delivered for visual review.
        fs.mkdirSync(path.join(base,"examples"),{recursive:true});
        await page.locator(".node").screenshot({path:path.join(base,"examples","interface-preview.png")});
        const layout=await page.evaluate(()=>{const root=node.visualCanvasEditor.root;return {height:root.getBoundingClientRect().height,scrollHeight:root.scrollHeight,clientHeight:root.clientHeight}});
        assert.ok(layout.height<=610,JSON.stringify(layout));assert.equal(layout.scrollHeight,layout.clientHeight);
        await page.getByRole("button",{name:"重置",exact:true}).click();
        assert.deepEqual((await state()).draft.rect,{x:0,y:0,width:400,height:300});assert.equal((await state()).locked,null);
        await page.getByRole("button",{name:"✓ 确认",exact:true}).click();
        assert.equal((await state()).locked.rect.width,400);
        assert.equal(errors.length,0,errors.join("\n"));
        console.log("UI PASS: immediate LoadImage preview, corner drag, color, locking, refresh, workflow restoration, cancel/reconfirm, reset, layout. API fixture; no live ComfyUI server.");
        await page.evaluate(()=>node.onRemoved());
    } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
