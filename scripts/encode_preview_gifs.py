"""Generate animated GIF previews from the playing assets ( dsh-pet/assets/webm -> dsh-pet/assets/preview ).

 Ancillary steps of the asset processing chain: Convert the transparent WebM (dsh-pet/assets/webm/) actually played by the plug-in into GIF preview
(dsh-pet/assets/preview/), for GitHub README and other Markdown pages to display.

Why this step is needed:
- The Markdown renderer of GitHub only generates an inline video player for "attachments uploaded on the web page";
  webm referenced by < video > in the warehouse will not play (raw returns audio/webm MIME).
- Pictures in the warehouse (including GIF) can be displayed normally inline using the Markdown picture syntax.
- Therefore, the README preview area is demonstrated with GIF, and the complete transparent video is still retained in assets/webm / in the form of webm.

Transparent processing: GIF supports 1 bit transparent. The source webm has a transparent background. Directly converting it to GIF will remove the transparent area.
Convert to black; this script uses palettegen/paletteuse to retain alpha, and the transparent part is displayed as the background color on the page.

Output naming: Output the pinyin file name according to the warehouse convention (README effect preview
< img src =" dsh-pet/assets/preview /<Pinyin>. gif "> corresponds one-to-one with the PINYIN table);
Animation names that are not in the table fall back to Chinese names.

Usage:
   python scripts/encode_preview_gifs.py # All (sorted by name)
   python scripts/encode_preview_gifs.py working status-jubilation celebration # Specify one/more"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "dsh-pet" / "assets" / "webm"
OUT = ROOT / "dsh-pet" / "assets" / "preview"
# Uniformly use ffmpeg that comes with the workspace (the asset processing chain has zero third-party dependencies)
FFMPEG = str(ROOT / ".tools" / "ffmpeg-9.0.1-essentials_build" / "bin" / "ffmpeg.exe")

# GIF parameters (GIF is large, just use low frame rate + medium size for preview)
WIDTH = 220    # Preview width (maintain aspect ratio)
FPS = 12       # Preview frame rate (webm 24 fps → 12 fps, the size is halved and smooth enough)

# Animation name → Pinyin output file name (consistent with img src of README effect preview)
PINYIN = {
    "待机呼吸休闲": "daiji-huxi-xiuxian",
    "东张西望": "dongzhangxiwang",
    "螃蟹走路": "pangxie-zoulu",
    "原地漂浮踏步": "yuandi-piaofu-tabu",
    "原地左转奔跑": "yuandi-zuozhuan-benpao",
    "悠闲哼歌": "youxian-hengga",
    "超大伸懒腰": "chaoda-shenlanyao",
    "原地敲击桌面互动": "yuandi-qiaoji-zhuomian-hudong",
    "原地重力下蹲压缩": "yuandi-zhongli-xiadun-yasuo",
    "哈欠连天": "haqian-liantian",
    "原地小憩沉眠": "yuandi-xiaoqi-chenmian",
    "女仆屈膝礼仪": "nvpu-quxi-liyi",
    "被吓一跳": "beixiayitiao-zhamao",
    "小幅度原地360度旋转展示": "xiaofudu-yuandi-360du-xuanzhuan-zhanshi",
    "偷吃零食被抓住": "touchi-lingshi-bei-zhuazhu",
    "用鲸鱼尾巴拍打地面": "yong-jingyu-weiba-paidadi",
    "打瞌睡被惊醒": "da-keshui-bei-jingxing",
    "照镜子": "zhao-jingzi",
    "整体换装试色": "zhengti-huanzhuang-shise",
    "轻快记录": "qingkuai-jilu",
    "写代码": "xie-daima",
    "摇扇纳凉": "yaoshan-naliang",
    "晨间刷牙": "chenjian-shuaya",
    "原地专心玩魔方": "yuandi-zhuanxin-wan-mofang",
    "原地蹲下玩玩具汽车": "yuandi-dunxia-wan-wanju-qiche",
    "鲸鱼吐泡泡特效": "jingyu-tu-paopao-texiao",
    "原地跳跃抓碎头顶物品": "yuandi-tiaoyue-zhuasui-touding-wupin",
    "玩游戏气急败坏": "wan-youxi-qijibaituai",
    "玩水枪": "wan-shuiqiang",
    "小提琴演奏": "xiaotiqin-yanzou",
    "蓝鲸现世": "lanjing-xianshi",
    "优雅女仆舞": "youya-nvpuwu",
    "轻快摇摆舞": "qingkuai-yaobaiwu",
    "可爱宅舞": "keai-zhaiwu",
    "吹气球": "chui-qiqiu",
    "动物环绕": "dongwu-huanrao",
    "放风筝": "fang-fengzheng",
    "拆礼物": "chai-liwu",
    "变鸽子": "bian-gezi",
    "扑克魔术": "puke-moshu",
    "抽陀螺": "chou-tuoluo",
    "吹笛子": "chui-dizi",
    "蝴蝶蜜蜂环绕头顶开花": "hudie-mifeng-huanrao-touding-kaihua",
    "撸猫": "lu-mao",
    "凭空生花": "pingkong-shenghua",
    "骑木马": "qi-muma",
    "三球抛接": "sanqiu-paojie",
    "踢毽子": "ti-jianzi",
    "下五子棋": "xiawuziqi",
    "荡秋千": "dangqiuqian",
    "吃白饭": "chi-baifan",
    "大口吃零食": "dakou-chi-lingshi",
    "吃Token": "chi-token",
    "吃早餐": "chi-zaocan",
    "吃午餐": "chi-wucan",
    "吃晚餐": "chi-wancan",
    "吃冰淇淋融化": "chi-bingqilin-ronghua",
    "吃大闸蟹": "chi-dazhaxie",
    "吃糖葫芦": "chi-tanghulu",
    "吃长寿面": "chi-changshoumian",
    "吃西瓜": "chi-xigua",
    "涮火锅": "shuan-huoguo",
    "被落叶淹没": "beiluoye-yanmo",
    "中秋赏月吃月饼": "zhongqiu-shangyue-chi-yuebing",
    "堆雪人": "duixueren",
    "放烟花": "fang-yanhua",
    "吃粽子": "chi-zongzi",
    "吃年糕": "chi-niangao",
    "吃青团": "chi-qingtuan",
    "吃腊八粥": "chi-labazhou",
    "吃重阳糕": "chi-chongyanggao",
    "收红包": "shou-hongbao",
    "写福字": "xie-fuzi",
    "穿针乞巧": "chuanzhenqiqiao",
    "舞狮头": "wu-shitou",
    "讨糖南瓜灯": "taotang-nanguadeng",
    "插茱萸赏菊": "cha-zhuyu-shangju",
    "放河灯": "fanghedeng",
    "萌化小幽灵": "menghua-xiaoyouling",
    "装点圣诞树": "zhuangdian-shengdanshu",
    "放孔明灯": "fang-kongmingdeng",
    "吃汤圆": "chitangyuan",
    "吃饺子": "chijiaozi",
    "是啊，吃什么": "shia-chishenme",
    "深度思考碎碎念": "shendu-sikao-suisuinian",
    "点击回应-开心跃动": "dianji-huiying-kaixin-yuedong",
    "点击回应-害羞惊讶": "dianji-huiying-haixiu-jingya",
    "点击回应-傲娇生气": "dianji-huiying-aojiao-shengqi-ceshen-zhanshi",
    "点击回应-挠痒咯咯笑": "dianji-huiying-naoyang-gegexiao",
    "点击回应-元气挥手": "dianji-huiying-yuanqi-huishou",
    "被鼠标拖拽悬空反馈": "beishubiao-tuozhuai-xuankong-fankui",
    "余额-钱袋满溢": "qian-dai-man-yi",
    "余额-金袋叮当": "jin-dai-ding-dang",
    "余额-钱袋如常": "qian-dai-ru-chang",
    "余额-数金皱眉": "shu-jin-zhou-mei",
    "余额-袋空如洗": "dai-kong-ru-xi",
    "余额-分文不剩": "fen-wen-bu-sheng",
    "碎碎念-擦桌碎碎念": "suisuinian-cazhuo-suisuinian",
    "碎碎念-发呆碎碎念": "suisuinian-fadai-suisuinian",
    "碎碎念-对屏碎碎念": "suisuinian-duiping-suisuinian",
    "工作状态-思考冒泡": "gongzuozhuangtai-sikao-maopao",
    "工作状态-忙碌点按": "gongzuozhuangtai-manglu-dianan",
    "工作状态-清点归档": "gongzuozhuangtai-qingdian-guidang",
    "工作状态-原地踱步张望": "gongzuozhuangtai-yuandi-duobu-zhangwang",
    "工作状态-雀跃庆祝": "gongzuozhuangtai-queyue-qingzhu",
    "工作状态-垂头叹气冒汗": "gongzuozhuangtai-chuitou-tanqi-maohan",
    "睡觉-开始": "shuijiao-kaishi",
    "睡觉-循环": "shuijiao-xunhuan",
    "睡觉-起来": "shuijiao-qilai",
}


def convert_gif(name: str) -> Path:
    src = SRC / f"{name}.webm"
    if not src.exists():
        raise FileNotFoundError(f"{src} does not exist")
    out_name = PINYIN.get(name, name)
    dst = OUT / f"{out_name}.gif"
    # Palette two-pass method: first generate the global palette, then convert the palette to GIF and retain alpha
    cmd = [
        FFMPEG,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-c:v",
        "libvpx-vp9",  # Consistent with encode_thumbs.py: libvpx decoding reserved VP9 alpha
        "-i",
        str(src),
        "-vf",
        (
            f"fps={FPS},scale={WIDTH}:-1:flags=lanczos,"
            "split[s0][s1];"
            "[s0]palettegen=stats_mode=diff[p];"
            "[s1][p]paletteuse=dither=bayer:diff_mode=rectangle"
        ),
        "-loop",
        "0",
        str(dst),
    ]
    result = subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return dst


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    names = sys.argv[1:] or sorted(p.stem for p in SRC.glob("*.webm"))
    total = 0
    for i, name in enumerate(names, start=1):
        try:
            dst = convert_gif(name)
            size = dst.stat().st_size
            total += size
            print(f"[{i}/{len(names)}] {PINYIN.get(name, name)}.gif  {size / 1e6:.1f}MB", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"[{i}/{len(names)}] {name}  FAIL: {exc}", flush=True)
            return 1
    print(f"\n=== summary ===")
    print(f"gifs: {len(names)}")
    print(f"preview total: {total / 1e6:.1f}MB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

