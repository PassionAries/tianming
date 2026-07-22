#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# tm-workshop-hotfix-v3 · 生产事故热修（2026-07-22）
# 病根：v2.2 把 pack_public 链式包装器【追加到文件末尾】，而服务的阻塞点
#   （__main__ 守卫内 serve）在文件中段——EOF 之后的 def 永不执行；原函数
#   又已被改名为 _pack_public_v1 → 下发路由运行时 NameError:
#   "name 'pack_public' is not defined" → /workshop/catalog 等整体 500，
#   前端表现为工坊内容（含 mod）全消失。数据库行未受损。
# 修法：把该包装器块原样【前移】到 __main__ 守卫之前（兜底锚=_pack_public_v1
#   函数尾）。幂等·备份·py_compile 失败自动回滚·锚不符即中止零改动。
import os
import re
import sys
import time
import shutil
import py_compile

TARGET = "/opt/tianming-online/tianming_online_service.py"
MARK = "tm-workshop-assets-patch-v2"
FIX_MARK = "tm-workshop-hotfix-v3"


def say(msg):
    line = "[hotfix-v3] " + msg
    try:
        print(line)
    except Exception:  # 非 UTF-8 控制台（如 Windows GBK）打印 ✓ 类字符会炸·降级按字节写
        sys.stdout.buffer.write((line + "\n").encode("utf-8", "replace"))


def main():
    if not os.path.isfile(TARGET):
        say("✗ 找不到 " + TARGET)
        sys.exit(1)
    with open(TARGET, "r", encoding="utf-8") as fh:
        src = fh.read()
    if FIX_MARK in src:
        say("✓ 已打过 v3 热修·幂等跳过")
        sys.exit(0)
    if "def _pack_public_v1(" not in src:
        say("✗ 未见 _pack_public_v1（v2 未打或形态不符）·零改动退出")
        sys.exit(1)

    # 定位 v2 追加在文件尾的包装器块（严格锚定到 EOF·尾部若有别的内容则不匹配=安全中止）
    m = re.search(
        r"\n*# " + re.escape(MARK) + r" · pack_public [^\n]*\n"
        r"def pack_public\(row\):\n(?:.*\n)*?    return d\n?\s*$",
        src,
    )
    if not m:
        say("✗ 未在文件尾锚到 v2 包装器块（可能已被移动/形态不符）·零改动退出")
        say("  请把文件最后 40 行贴给助手核对：tail -40 " + TARGET)
        sys.exit(1)
    head = src[: m.start()]
    block = m.group(0).strip("\n")

    if re.search(r"(?m)^def pack_public\(", head):
        say("✗ 守卫前已存在 pack_public 定义·情况异常·零改动退出")
        sys.exit(1)

    stamped = (
        "\n\n" + block + "\n"
        "# " + FIX_MARK + " · 包装器已前移（v2 误附文件尾·位于服务阻塞点之后永不执行·致下发 NameError）\n\n\n"
    )

    gm = re.search(r"(?m)^if __name__ == [\"']__main__[\"']\s*:", head)
    if gm:
        new_src = head[: gm.start()] + stamped + head[gm.start():]
        say("锚=__main__ 守卫（第 %d 行）" % (head[: gm.start()].count("\n") + 1))
    else:
        dm = re.search(r"(?m)^def _pack_public_v1\(", head)
        if not dm:
            say("✗ 兜底锚 _pack_public_v1 也未找到·零改动退出")
            sys.exit(1)
        after = head[dm.end():]
        nx = re.search(r"(?m)^\S", after)
        ins = dm.end() + (nx.start() if nx else len(after))
        new_src = head[:ins] + stamped + head[ins:]
        say("锚=_pack_public_v1 函数尾（兜底·本文件无 __main__ 守卫）")

    bak = TARGET + ".bak-v3hotfix-" + time.strftime("%Y%m%d%H%M%S")
    shutil.copy2(TARGET, bak)
    with open(TARGET, "w", encoding="utf-8") as fh:
        fh.write(new_src)
    try:
        py_compile.compile(TARGET, doraise=True)
    except Exception as exc:  # noqa: BLE001
        shutil.copy2(bak, TARGET)
        say("✗ 语法校验失败·已从备份整体回滚：" + str(exc))
        sys.exit(1)

    chk = open(TARGET, encoding="utf-8").read()
    dpos = chk.find("\ndef pack_public(row):")
    mpos = chk.find('\nif __name__ == "__main__"')
    if mpos == -1:
        mpos = chk.find("\nif __name__ == '__main__'")
    if mpos != -1 and dpos != -1 and dpos > mpos:
        shutil.copy2(bak, TARGET)
        say("✗ 终验失败（定义仍在守卫之后）·已回滚")
        sys.exit(1)
    say("✓ 终验通过：def pack_public @%d 字节 %s" % (dpos, ("< __main__ 守卫 @%d" % mpos) if mpos != -1 else "（无守卫·兜底锚）"))
    say("✓ 备份=" + os.path.basename(bak))
    say("完成 · 请重启：systemctl restart tianming-online")


main()
