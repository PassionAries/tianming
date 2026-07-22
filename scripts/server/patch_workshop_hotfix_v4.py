#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# tm-workshop-hotfix-v4 · 生产事故热修二段（2026-07-22）
# 病根：v3 使包装器真正生效后暴露第二层缺陷——线上原 pack_public 真实签名
#   为多参（调用点传 3 个位置参数），v2 包装器按单参 (row) 写 → TypeError:
#   "pack_public() takes 1 positional argument but 3 were given"。
# 修法：包装器签名改变参透传 (row, *a, **kw)，内调 _pack_public_v1(row, *a, **kw)。
#   幂等·备份·py_compile 失败自动回滚·锚不符零改动中止。
import os
import re
import sys
import time
import shutil
import py_compile

TARGET = "/opt/tianming-online/tianming_online_service.py"
FIX_MARK = "tm-workshop-hotfix-v4"


def say(msg):
    line = "[hotfix-v4] " + msg
    try:
        print(line)
    except Exception:
        sys.stdout.buffer.write((line + "\n").encode("utf-8", "replace"))


def main():
    if not os.path.isfile(TARGET):
        say("✗ 找不到 " + TARGET)
        sys.exit(1)
    with open(TARGET, "r", encoding="utf-8") as fh:
        src = fh.read()
    if FIX_MARK in src:
        say("✓ 已打过 v4 热修·幂等跳过")
        sys.exit(0)
    if "def _pack_public_v1(" not in src:
        say("✗ 未见 _pack_public_v1·形态不符·零改动退出")
        sys.exit(1)
    if "def pack_public(row, *a, **kw):" in src:
        say("✓ 包装器已是变参形·补标记即可")
        src2 = src.replace("def pack_public(row, *a, **kw):", "def pack_public(row, *a, **kw):  # " + FIX_MARK, 1)
        _write(src, src2)
        sys.exit(0)
    if "def pack_public(row):" not in src:
        say("✗ 未找到单参包装器 def pack_public(row): ·零改动退出")
        sys.exit(1)
    n_def = src.count("def pack_public(row):")
    if n_def != 1:
        say("✗ 包装器定义出现 %d 次·情况异常·零改动退出" % n_def)
        sys.exit(1)
    src2 = src.replace(
        "def pack_public(row):",
        "def pack_public(row, *a, **kw):  # " + FIX_MARK + " · 变参透传适配线上原签名",
        1,
    )
    # 包装器体内对 v1 的链式调用同步透传（只应有一处）
    n_call = src2.count("_pack_public_v1(row)")
    if n_call != 1:
        say("✗ 链式调用 _pack_public_v1(row) 出现 %d 次·情况异常·零改动退出" % n_call)
        sys.exit(1)
    src2 = src2.replace("_pack_public_v1(row)", "_pack_public_v1(row, *a, **kw)", 1)
    _write(src, src2)


def _write(old_src, new_src):
    bak = TARGET + ".bak-v4hotfix-" + time.strftime("%Y%m%d%H%M%S")
    shutil.copy2(TARGET, bak)
    with open(TARGET, "w", encoding="utf-8") as fh:
        fh.write(new_src)
    try:
        py_compile.compile(TARGET, doraise=True)
    except Exception as exc:  # noqa: BLE001
        shutil.copy2(bak, TARGET)
        say("✗ 语法校验失败·已从备份整体回滚：" + str(exc))
        sys.exit(1)
    say("✓ 包装器已改变参透传 (row, *a, **kw)")
    say("✓ 备份=" + os.path.basename(bak))
    say("完成 · 请重启：systemctl restart tianming-online")


main()
