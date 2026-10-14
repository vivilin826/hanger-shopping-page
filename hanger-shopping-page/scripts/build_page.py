#!/usr/bin/env python3
"""Build one portable HTML from a prepared frontend folder; Python standard library only."""
import argparse,base64,copy,html,json,math,mimetypes,re
from pathlib import Path


def local_file(root,value):
    if not isinstance(value,str) or not value or '://' in value or value.startswith('data:'):
        raise ValueError('素材必须是项目内的相对路径')
    p=(root/value).resolve()
    if not p.is_relative_to(root) or not p.is_file():
        raise ValueError('素材不存在或越出项目目录: '+value)
    return p


def data_uri(root,value):
    p=local_file(root,value)
    mime={'.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2'}.get(p.suffix.lower())
    if not mime:raise ValueError('不支持的素材类型: '+p.suffix)
    return 'data:'+mime+';base64,'+base64.b64encode(p.read_bytes()).decode('ascii')


def validate(config,root):
    if not isinstance(config,dict):raise ValueError('catalog必须为对象')
    if not config.get('brand',{}).get('name'):raise ValueError('缺少品牌或演示店名')
    products=config.get('products',[]);specs=config.get('suspension',[])
    if not products or len(products)!=len(specs):raise ValueError('至少一款，商品和几何配置必须对应')
    ids=set()
    for product,spec in zip(products,specs):
        if not product.get('id') or product['id'] in ids or not product.get('name'):raise ValueError('商品id须唯一，且须有品名')
        ids.add(product['id'])
        for view in ('front','side'):
            local_file(root,product.get(view));pose=spec[view]
            for key in ('width','height','displayHeight'):
                if not isinstance(pose.get(key),(int,float)) or not math.isfinite(pose[key]) or pose[key]<=0:raise ValueError('图片几何尺寸须为正有限数')
            if not 0<=pose['anchor']<=1 or not math.isfinite(pose['top']):raise ValueError('挂钩锚点无效')
            pin=(25-pose['top'])/pose['displayHeight']
            if not 0<=pin<=1:raise ValueError('挂钩必须位于图片范围内')
        if spec.get('height',0)<=0:raise ValueError('服装高度须为正')
        if not 0<=spec['front'].get('clothStartV',.2)<1:raise ValueError('布料支撑区比例无效')
        for key in ('leftExtent','rightExtent'):
            if not math.isfinite(spec['side'].get(key,-1)) or spec['side'].get(key,-1)<0:raise ValueError('侧挂轮廓范围无效')
    if config['brand'].get('storeUrl') and not re.match(r'^https?://[^\s]+$',config['brand']['storeUrl']):raise ValueError('店铺入口须为http/https网址')


def build(directory,output):
    root=Path(directory).resolve();target=Path(output).resolve()
    if target.exists():raise FileExistsError('输出已存在，请另存新版本: '+str(target))
    if target.suffix.lower()!='.html':raise ValueError('输出须为HTML文件')
    config=json.loads((root/'catalog.json').read_text(encoding='utf-8'));validate(config,root)
    embedded=copy.deepcopy(config)
    for product in embedded['products']:
        for key in ('front','side'):product[key]=data_uri(root,product[key])
    css=(root/'styles.css').read_text(encoding='utf-8')
    def css_url(match):
        value=match.group(1).strip(' \"\'')
        return match.group(0) if value.startswith('data:') else 'url("'+data_uri(root,value)+'")'
    css=re.sub(r'url\(([^)]+)\)',css_url,css)
    app=(root/'app.js').read_text(encoding='utf-8')
    assets={str(p.relative_to(root)):data_uri(root,str(p.relative_to(root))) for p in (root/'assets').glob('*.svg')}
    old='src="assets/${SUSPENSION[index].hangerAsset||(SUSPENSION[index].clip?\'clip-hanger\':\'hanger\')}.svg"'
    new='src="${ARCHIVE_ASSETS[\'assets/\'+(SUSPENSION[index].hangerAsset||(SUSPENSION[index].clip?\'clip-hanger\':\'hanger\'))+\'.svg\']}"'
    if old not in app:raise ValueError('模板衣架资源接入不匹配')
    app=app.replace(old,new)
    js='window.SHOP_CONFIG='+json.dumps(embedded,ensure_ascii=True)+';\nconst ARCHIVE_ASSETS='+json.dumps(assets)+';\n'
    js+='\n'.join((root/name).read_text(encoding='utf-8') for name in ('rack-physics.js','cloth-mesh.js'))+'\n'+app
    page=(root/'index.html').read_text(encoding='utf-8')
    page=re.sub(r'<link[^>]+href="styles\.css[^\"]*"[^>]*>',lambda _: '<style>\n'+css+'\n</style>',page)
    page=re.sub(r'<script[^>]+src="(?:app|rack-physics|cloth-mesh)\.js[^\"]*"[^>]*></script>','',page)
    for path in re.findall(r'(?:href|src)="(assets/[^\"]+)"',page):page=page.replace('"'+path+'"','"'+data_uri(root,path)+'"')
    page=re.sub(r'<title>.*?</title>','<title>'+html.escape(config['brand']['name'])+' · 衣架购物</title>',page)
    page=page.replace('</body>','<script>\n'+js.replace('</','<\\/')+'\n</script>\n</body>')
    if re.search(r'(?:src|href)="(?:assets/|(?:app|rack-physics|cloth-mesh)\.js|styles\.css)',page):raise ValueError('仍有未内嵌资源')
    target.parent.mkdir(parents=True,exist_ok=True)
    with target.open('x',encoding='utf-8') as f:f.write(page)
    return {'html':str(target),'products':len(config['products']),'bytes':target.stat().st_size}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('directory');parser.add_argument('--output',required=True)
    args=parser.parse_args()
    try:print(json.dumps(build(args.directory,args.output),ensure_ascii=False))
    except (ValueError,KeyError,FileNotFoundError,FileExistsError) as exc:parser.exit(1,str(exc)+'\n')
