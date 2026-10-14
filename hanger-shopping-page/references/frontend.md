# 前端接入约定

模板采用原生HTML/CSS/JS和单WebGL图片网格，包含拖拽/轻点区分、木架与布料滞后、沿杆轮廓接触、静止详情、触摸和停稳。照片转正是图片视图过渡与网格形变的近似效果，不是完整三维衣物仿真。

复制`assets/frontend/`到本次输出目录，生成图片放入其`assets/products/`。可自由调整版面、字体、配色、品牌文案，但保留脚本所依赖的DOM id/class，或同步改动脚本。不把原作者的品牌、照片、用户路径写入客户项目。

## catalog.json

```json
{
  "brand": {"name":"演示衣橱", "slogan":"慢慢挑选喜欢的那一件", "about":"服装交互陈列", "ctaLabel":"查看款式"},
  "products": [
    {"id":"item-01", "name":"奶油白上衣", "english":"", "description":"", "front":"assets/products/item-01-front.png", "side":"assets/products/item-01-side.png"}
  ],
  "suspension": [
    {
      "height":300,
      "front":{"width":1000,"height":1500,"anchor":0.5,"top":10,"displayHeight":375,"clothStartV":0.22},
      "side":{"width":1000,"height":1500,"anchor":0.5,"top":10,"displayHeight":375,"leftExtent":45,"rightExtent":50}
    }
  ]
}
```

以上是结构示例，几何数值必须依据新图片测量，不能原样照抄。`products`与`suspension`逐项一一对应，至少一款。`priceText`只有已提供真实信息时才填；缺省不展示价格。`brand.contact`可填客户提供的联系说明。`brand.storeUrl`可选客户明确提供的http/https店铺入口，未提供则CTA仅查看款式、复制询款。主题可在CSS中修改，默认暖米色与木架。

## 图片锚点与尺寸

模型参考宽度280，挂钩接触杆的位置恒为(140,25)。每张图测量实际像素宽高W/H、挂钩接触点(hookX,hookY)、可见下摆bottomY、木架下端/布料支撑区结束woodY。

选择该款侧图的展示尺度s，使服装保持合理长度。其挂钩固定后，可见下摆目标为`25+(bottomY-hookY)*s`。正面使用自己的挂钩到下摆像素距离推导等比尺度，使同款两视图的可见下摆对齐。不要靠任意拉伸图片匹配。

每视图：`anchor=hookX/W`，`displayHeight=H*s`，`top=25-hookY*s`，`width=W`，`height=H`。正面`clothStartV=woodY/H`：此处以上保持木架支撑的刚性，以下逐渐由衣身到衣摆跟随。`suspension.height`用于服装长度/重量分级；侧图`leftExtent/rightExtent`是从挂钩中心到可见轮廓左右最远点的模型距离。实际透明轮廓还会由渲染器读取，供碰撞约束使用。

前后视图的alpha边界和挂钩都应检查。款式之间保持各自长短宽窄，不能统一拉成一样大小。挂钩均匀排列；单款置中，更多款可横向滚动并检查拥挤程度。

## 构建与交付

`python3 SKILL_DIR/scripts/build_page.py OUTPUT_DIR --output OUTPUT_DIR/衣架购物页.html`

脚本仅用Python标准库，读取输出目录内的catalog、模板源码与素材，嵌入图片、字体、CSS和JS。路径只能指向该输出目录内的文件；先将客户指定素材复制入项目，不能把客户其他目录内容顺手打包。

成品包含交互HTML、正侧悬挂PNG、源码与配置。外链发布、真实购买/支付、后台库存另行处理。无WebGL时保留图片交互回退，但不宣称具有相同的布料变形效果。客户可直接双击HTML，后续修改配置后重建新版本。
