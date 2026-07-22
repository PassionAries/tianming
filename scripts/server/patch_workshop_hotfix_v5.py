#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# tm-workshop-hotfix-v5 · 生产事故热修终段（2026-07-22·按 owner grep 真身地图定制）
# 真身：482 def _pack_public_base(row, rating=None, endorsements=0)（真原函数·多参）
#      2363 def pack_public(row)（v2 包装器·v3 已前移守卫前·但单参）
#      2395 def _pack_public_v1(row)（v1 封面包装器·仍误附文件尾=守卫后死代码·且单参）
# 两病齐修：①v1 块前移守卫前 ②两层包装器全部变参透传 (row, *a, **kw)。
# 幂等·备份·py_compile 失败回滚·任何锚/计数不符零改动中止。
import os
import re
import sys
import time
import shutil
import py_compile

TARGET = "/opt/tianming-online/tianming_online_service.py"
FIX_MARK = "tm-workshop-hotfix-v5"


def say(msg):
    line = "[hotfix-v5] " + msg
    try:
        print(line)
    except Exception:
        sys.stdout.buffer.write((line + "\n").encode("utf-8", "replace"))


def bail(msg):
    say("✗ " + msg + "·零改动退出")
    sys.exit(1)


def main():
    if not os.path.isfile(TARGET):
        bail("找不到 " + TARGET)
    with open(TARGET, "r", encoding="utf-8") as fh:
        src = fh.read()
    if FIX_MARK in src:
        say("✓ 已打过 v5 热修·幂等跳过")
        sys.exit(0)
    for needle, label in (
        ("def _pack_public_base(row", "真原函数 _pack_public_base"),
        ("def pack_public(row):", "v2 包装器（单参）"),
        ("def _pack_public_v1(row):", "v1 封面包装器（单参）"),
    ):
        if src.count(needle) != 1:
            bail(label + " 出现 %d 次（预期 1）" % src.count(needle))

    # ① v1 封面包装器块仍在文件尾（守卫后死代码）→ 前移
    m = re.search(
        r"\n*# tm-workshop-cover-patch-v1 · pack_public [^\n]*\n"
        r"def _pack_public_v1\(row\):\n(?:.*\n)*?    return d\n?\s*$",
        src,
    )
    if not m:
        bail("未在文件尾锚到 v1 封面包装器块（形态不符）·请贴 tail -60 " + TARGET)
    head = src[: m.start()]
    v1block = m.group(0).strip("\n")
    gm = re.search(r"(?m)^if __name__ == [\"']__main__[\"']\s*:", head)
    if not gm:
        bail("未找到 __main__ 守卫锚")
    if "def pack_public(row):" not in head[: gm.start()]:
        bail("v2 包装器不在守卫前（v3 未生效？）·形态不符")
    src = head[: gm.start()] + "\n\n" + v1block + "\n# " + FIX_MARK + " · v1 封面包装器前移（原误附文件尾·守卫后永不执行）\n\n\n" + head[gm.start():]

    # ② 两层包装器 + 两处链式调用全部变参透传（逐个严格计数）
    edits = [
        ("def pack_public(row):", "def pack_public(row, *a, **kw):"),
        ("d = _pack_public_v1(row)", "d = _pack_public_v1(row, *a, **kw)"),
        ("def _pack_public_v1(row):", "def _pack_public_v1(row, *a, **kw):"),
        ("d = _pack_public_base(row)", "d = _pack_public_base(row, *a, **kw)"),
    ]
    for old, new in edits:
        n = src.count(old)
        if n != 1:
            bail("『%s』出现 %d 次（预期 1）" % (old, n))
        src = src.replace(old, new, 1)

    bak = TARGET + ".bak-v5hotfix-" + time.strftime("%Y%m%d%H%M%S")
    shutil.copy2(TARGET, bak)
    with open(TARGET, "w", encoding="utf-8") as fh:
        fh.write(src)
    try:
        py_compile.compile(TARGET, doraise=True)
    except Exception as exc:  # noqa: BLE001
        shutil.copy2(bak, TARGET)
        say("✗ 语法校验失败·已从备份整体回滚：" + str(exc))
        sys.exit(1)

    chk = open(TARGET, encoding="utf-8").read()
    g = chk.find('\nif __name__ == "__main__"')
    if g == -1:
        g = chk.find("\nif __name__ == '__main__'")
    p2 = chk.find("\ndef pack_public(row, *a, **kw):")
    p1 = chk.find("\ndef _pack_public_v1(row, *a, **kw):")
    if not (0 < p2 < g and 0 < p1 < g):
        shutil.copy2(bak, TARGET)
        say("✗ 终验失败（包装器定义未全部位于守卫前）·已回滚")
        sys.exit(1)
    say("✓ 终验通过：pack_public@%d 与 _pack_public_v1@%d 均 < 守卫@%d·两层已变参透传" % (p2, p1, g))
    say("✓ 备份=" + os.path.basename(bak))
    say("完成 · 请重启：systemctl restart tianming-online")


main()
