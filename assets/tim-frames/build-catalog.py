"""Human-visible frame observations encoded by the Codex modeling worker.

Every numbered image in full-0.jpg ... full-4.jpg has been visually inspected.
Only visibly recurring silhouettes/color/material combinations are combined.
Close variants remain separate; this is an appearance index, not a SKU count.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT/'assets/tim-frames'
FRAMES = ROOT.parent/'specs/007-tim-eyewear-cloudflare/evidence/video-frames.json'
frames = json.loads(FRAMES.read_text())['frames']
models = json.loads((ASSETS/'catalog.json').read_text())['models'][:8]
black = {'rgb':[.006,.007,.009], 'palette':'black', 'color':'墨黑', 'material':'醋酸纤维外观', 'styles':['classic'], 'rim':1.8}
clear = {'rgb':[.66,.72,.75], 'palette':'clear', 'color':'透明冷灰', 'material':'透明醋酸纤维外观', 'alpha':.43, 'styles':['minimal','creative'], 'rim':1.7}
gold = {'rgb':[.49,.38,.23], 'palette':'gold', 'color':'浅金', 'material':'细金属外观', 'metal':.86, 'styles':['minimal','classic'], 'rim':.72, 'templeRadius':.85}
silver = {'rgb':[.48,.52,.56], 'palette':'silver', 'color':'银灰', 'material':'细金属外观', 'metal':.88, 'styles':['minimal'], 'rim':.72, 'templeRadius':.85}
brown = {'rgb':[.12,.058,.027], 'palette':'brown', 'color':'烟茶棕', 'material':'半透明醋酸纤维外观', 'alpha':.72, 'styles':['classic'], 'rim':1.65}
rimless = silver|{'design':'rimless','shape':'rimless','material':'无框镜片与细金属支架外观','rim':.7}
brow = black|{'design':'browline','shape':'browline','rim':.72,'browRim':1.9,'material':'深色眉架与细金属下框外观'}
base = {'width':54,'height':40,'gap':19,'temple_length':140,'exponent':2.5,'shape':'oval','cy':-11,'description':'依据逐帧正面外观近似重建；相近款式可能属于同一商品，作为外观变体保留。侧面结构、毫米尺寸与镜片材质为示意，未复制品牌标识。'}
rows = [
([2,3,4], '窄黑矩形', black, {'shape':'rectangle','width':55,'height':32,'gap':18,'exponent':4,'rim':2.2}),
([5,6], '水晶大圆', clear, {'shape':'round','height':46,'width':55,'exponent':2.2,'rim':1.65}),
([7], '紫镜运动盾', clear, {'design':'shield','shape':'shield','lens':'violet','color':'透明白 / 紫蓝镜片','palette':'blue','frontWidth':146,'rim':1.5,'fullRim':False,'rgb':[.74,.75,.82],'alpha':.8,'styles':['bold','creative']}),
([8,9,10], '无框浅椭圆', rimless, {'width':54,'height':31,'exponent':2.25,'gap':19}),
([11], '无框细长方', rimless, {'width':54,'height':29,'exponent':3.6,'gap':18}),
([12,13], '无框柔角方', rimless, {'width':55,'height':33,'exponent':3,'gap':18}),
([14,15], '无框宽矩形', rimless, {'width':57,'height':31,'exponent':4.4,'gap':17,'rgb':[.60,.53,.38],'palette':'gold','color':'淡金支架'}),
([16], '黑色柔角小方', black, {'shape':'square','width':52,'height':37,'gap':23,'exponent':3.0,'rim':2.15}),
([17], '厚黑圆框', black, {'shape':'round','height':46,'width':53,'gap':22,'exponent':2.1,'rim':2.5,'studs':True}),
([18], '黑色窄方框', black, {'shape':'rectangle','height':35,'width':54,'gap':19,'exponent':3.8,'rim':2.3,'studs':True}),
([19], '透灰上扬椭圆', clear, {'shape':'cat-eye','design':'cat','height':41,'width':55,'rgb':[.34,.31,.39],'alpha':.58,'rim':1.8}),
([20], '黑金细椭圆', black, {'shape':'oval','height':35,'width':53,'gap':23,'exponent':2,'rim':1.55,'browSlope':.001,'studs':True}),
([21], '透明细矩形', clear, {'shape':'rectangle','height':34,'width':55,'gap':18,'exponent':3.5,'rim':1.4}),
([22], '黑圆钥匙孔', black, {'shape':'round','height':43,'width':51,'gap':25,'exponent':2.15,'rim':2.3,'studs':True}),
([23], '烟灰直边方框', clear, {'shape':'rectangle','height':37,'width':54,'exponent':3.7,'rgb':[.22,.25,.27],'alpha':.68,'rim':2.0}),
([24], '黑色平顶方框', black, {'shape':'square','height':40,'width':53,'gap':22,'exponent':3.8,'rim':2.05,'taper':.025}),
([25,26], '浅金大圆框', gold, {'shape':'round','height':46,'width':54,'gap':19,'exponent':2.2,'rim':.80}),
([27], '黑银直眉方框', brow, {'height':40,'width':54,'exponent':3.6,'browRim':2.2}),
([28,29], '双桥金属飞行员', silver, {'shape':'aviator','design':'aviator','height':42,'width':55,'gap':18,'exponent':3.2,'doubleBridge':True,'rim':.9}),
([30], '黑色圆角波士顿', black, {'shape':'round','height':43,'width':52,'gap':23,'exponent':2.2,'rim':1.9,'taper':.055}),
([31], '深茶眉线方框', brow, {'height':42,'width':54,'exponent':3.0,'rgb':[.06,.024,.016],'palette':'brown','color':'深茶 / 银','browRim':1.7}),
([32], '厚黑柔圆框', black, {'shape':'oval','height':42,'width':53,'gap':22,'exponent':2.05,'rim':2.2,'taper':.045}),
([33,34], '细银圆飞行员', silver, {'shape':'aviator','design':'aviator','height':47,'width':54,'gap':21,'exponent':2.2,'doubleBridge':True,'rim':.72}),
([35], '烟晶窄矩形', clear, {'shape':'rectangle','height':37,'width':53,'gap':23,'exponent':3.5,'rgb':[.29,.30,.28],'alpha':.6,'rim':2.1}),
([36], '烟晶大方框', clear, {'shape':'square','height':46,'width':55,'gap':18,'exponent':3.1,'rgb':[.36,.32,.29],'alpha':.57,'rim':2.2}),
([37], '宽边黑方框', black, {'shape':'square','height':43,'width':55,'gap':18,'exponent':3.8,'rim':2.8,'taper':.04}),
([38], '茶色柔椭圆', brown, {'shape':'oval','height':39,'width':53,'gap':22,'exponent':2.4,'rim':1.65}),
([39], '黑银弧眉方框', brow, {'height':39,'width':53,'gap':22,'exponent':3.0,'browRim':1.85}),
([40], '黑色微上扬方框', black, {'shape':'square','height':42,'width':53,'gap':22,'exponent':3.35,'rim':2.4,'browSlope':.001}),
([41,42], '银灰圆角方框', silver, {'shape':'square','height':41,'width':54,'gap':21,'exponent':3.6,'rim':1.05,'browSlope':.0005}),
([43], '炭灰半透圆方', clear, {'shape':'square','height':39,'width':53,'gap':23,'exponent':3.0,'rgb':[.12,.14,.15],'alpha':.78,'rim':1.7}),
([44], '黑色小椭圆', black, {'shape':'oval','height':34,'width':52,'gap':24,'exponent':2,'rim':1.6}),
([45], '晶茶柔圆框', clear, {'shape':'round','height':41,'width':53,'gap':23,'exponent':2.4,'rgb':[.52,.41,.30],'palette':'brown','color':'透明浅茶','alpha':.50,'rim':1.8}),
([46], '细黑波士顿', black, {'shape':'round','height':40,'width':53,'gap':22,'exponent':2.25,'rim':1.45,'taper':.07}),
([47], '细金宽圆框', gold, {'shape':'round','height':43,'width':56,'gap':17,'exponent':2.35,'rim':.7}),
([48], '黑色上扬波士顿', black, {'shape':'cat-eye','design':'cat','height':43,'width':54,'gap':20,'exponent':2.6,'rim':2.25,'taper':.08}),
([49], '浅金柔方框', gold, {'shape':'square','height':40,'width':54,'gap':20,'exponent':2.9,'rim':.7}),
([50], '古金椭圆框', gold, {'shape':'oval','height':39,'width':53,'gap':23,'exponent':2.15,'rgb':[.28,.21,.12],'color':'古金','rim':.85}),
([51], '黑眉宽方框', brow, {'height':44,'width':56,'gap':18,'exponent':3.1,'browRim':1.8}),
([52], '黑金细眉椭圆', brow, {'height':39,'width':54,'gap':21,'exponent':2.4,'browRim':1.3,'rim':.65,'color':'黑金'}),
([53], '细黑柔椭圆', black, {'shape':'oval','height':41,'width':54,'gap':20,'exponent':2.5,'rim':1.35}),
([54], '无框纤细矩形', rimless, {'height':30,'width':53,'gap':22,'exponent':3.4}),
([55], '琥珀透明圆方', brown, {'shape':'square','height':42,'width':54,'gap':20,'exponent':2.8,'rgb':[.25,.12,.045],'alpha':.58,'rim':1.65}),
([56], '细黑金属矩形', black|{'metal':.65,'material':'细黑金属外观'}, {'shape':'rectangle','height':34,'width':55,'gap':19,'exponent':3.7,'rim':.95,'templeRadius':.9}),
([57], '小黑正圆框', black, {'shape':'round','height':40,'width':48,'gap':31,'exponent':2,'rim':2.25}),
([58], '黑色扁圆波士顿', black, {'shape':'oval','height':39,'width':53,'gap':23,'exponent':2.4,'rim':1.75,'taper':.06}),
([59], '水晶大波士顿', clear, {'shape':'round','height':45,'width':56,'gap':17,'exponent':2.35,'rim':2.3,'taper':.07}),
([60], '银底黑眉方框', brow, {'height':40,'width':54,'gap':20,'exponent':3.3,'browRim':1.55,'rim':.9}),
([61], '细金小椭圆', gold, {'shape':'oval','height':37,'width':52,'gap':24,'exponent':2.4,'rim':.68}),
([62], '细金大圆方', gold, {'shape':'square','height':43,'width':55,'gap':18,'exponent':2.8,'rim':.68}),
([63], '黑银柔方框', brow, {'height':38,'width':54,'gap':21,'exponent':3.0,'browRim':1.25,'rim':.8}),
([64], '淡紫透明椭圆', clear, {'shape':'oval','height':35,'width':53,'gap':23,'exponent':2.25,'rgb':[.40,.42,.70],'color':'淡紫透明','palette':'blue','rim':1.45,'alpha':.48}),
([65], '黑金柔角矩形', black|{'metal':.52,'material':'细黑金属与金色细节外观'}, {'shape':'rectangle','height':36,'width':54,'gap':21,'exponent':3.0,'rim':1.05}),
([66], '晶透金边圆框', clear, {'shape':'round','height':44,'width':54,'gap':20,'exponent':2.1,'rgb':[.65,.59,.43],'rim':1.5,'alpha':.46}),
([67], '黑金弧线波士顿', black, {'shape':'round','height':41,'width':52,'gap':24,'exponent':2.2,'rim':1.5,'studs':True,'taper':.06}),
([68], '宽厚黑色方框', black, {'shape':'square','height':43,'width':56,'gap':17,'exponent':4.0,'rim':3.0,'taper':.055}),
([69], '细银矩形框', silver, {'shape':'rectangle','height':33,'width':54,'gap':21,'exponent':3.7,'rim':.72}),
([70], '黑色大上扬圆框', black, {'shape':'cat-eye','design':'cat','height':44,'width':55,'gap':18,'exponent':2.2,'rim':2.1,'taper':.08}),
([71], '白色圆太阳镜', black, {'shape':'round','height':45,'width':54,'gap':20,'exponent':2.1,'rim':3.2,'rgb':[.9,.9,.86],'palette':'white','color':'象牙白 / 酒红镜片','lens':'wine','styles':['bold','creative']}),
([72], '白色方太阳镜', black, {'shape':'square','height':41,'width':55,'gap':19,'exponent':3.5,'rim':3.1,'rgb':[.86,.89,.90],'palette':'white','color':'冷白 / 烟色镜片','lens':'dark','styles':['bold','creative']}),
([73], '黑色上扬太阳镜', black, {'shape':'cat-eye','design':'cat','height':35,'width':55,'gap':19,'exponent':2.7,'rim':2.8,'lens':'dark','color':'黑框 / 烟色镜片','styles':['bold','classic']})
]
mapping = {0:'tim-08',1:'tim-08'}
for indices, label, profile, config in rows:
    number = len(models)+1
    spec = base|profile|config|{'id':f'tim-{number:02d}','label':f'{number:02d} · {label}','time':frames[indices[0]]['t'],'referenceLabel':label,'sourceFrameIndices':indices}
    spec['reference_times'] = [frames[i]['t'] for i in indices]
    models.append(spec)
    for index in indices:
        mapping[index] = spec['id']

# The late sequence visibly reprises earlier frame shapes, color and endpieces.
repeat_of = {74:5,75:44,76:45,77:46,78:47,79:48,80:49,81:50,82:11,83:11,84:12,85:67,86:68,87:2,88:2,89:5,90:5,91:7,92:8,93:8,94:8,95:35,96:36,97:37,98:38,99:39,100:40,101:41}
for index, earlier in repeat_of.items():
    mapping[index] = mapping[earlier]
    spec = next(m for m in models if m['id'] == mapping[index])
    spec['sourceFrameIndices'].append(index)
    spec['reference_times'].append(frames[index]['t'])
for spec in models[:8]:
    spec['reference_times'] = [spec['time']]
models[7]['reference_times'] += [frames[0]['t'],frames[1]['t']]
models[7]['sourceFrameIndices'] = [0,1]

coverage = {'source':'https://www.douyin.com/video/7711668743713066255','durationSeconds':11.181,'method':'Visual review of contact/detail plus every nonidentical image in full-0 through full-4. 1/60-second sampling collapsed adjacent identical RGB. Appearance variants, not distinct verified products.','modelCount':len(models),'earlySegments':[{'model':m['id'],'representativeTime':m['time'],'label':m['referenceLabel']} for m in models[:8]],'frames':[{'index':i,'time':f['t'],'model':mapping.get(i),'status':'mapped' if i<102 else 'no-glasses','repeatedAppearanceOf':repeat_of.get(i)} for i,f in enumerate(frames)],'uncertainty':'Fine differences between similar clear, rimless and black frames cannot establish commercial identity. Adjacent nearly identical silhouettes are combined; distinct-looking rapid frames retain separate approximate models. Hidden temples and dimensions are interpreted.'}
assert set(mapping) == set(range(102))
(ASSETS/'coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2)+'\n')
(ASSETS/'catalog.json').write_text(json.dumps({'status':'all-observed-appearances-mapped','models':models},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'models':len(models),'tailFramesMapped':len(mapping),'noGlasses':3,'repeatMappings':len(repeat_of)},ensure_ascii=False))
