#!/usr/bin/env python3
"""
evot CLI 工具
"""

import sys
import os
import argparse
import json
from datetime import datetime

# 添加 macbook 路径
sys.path.insert(0, os.path.expanduser('~/Polarisor/macbook'))

def cmd_observe_stub(args):
    """生成 observe stub 代码"""
    target = args.target
    output = args.output
    
    # 如果 target 是目录，生成目录中所有 Python 文件的 stub
    if os.path.isdir(target):
        generate_stubs_for_dir(target, output)
    elif os.path.isfile(target) and target.endswith('.py'):
        generate_stub_for_file(target, output)
    else:
        # 生成单个 stub
        generate_single_stub(target, output)

def generate_single_stub(func_signature, output):
    """生成单个函数的 observe stub"""
    stub_code = f'''# evot observe stub - Generated {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

from evot_observe_stub import (
    observe_stub,
    ObserveConfig,
    StubRegistry,
    make_mock_config
)

@observe_stub(
    name="{func_signature.split('(')[0] if '(' in func_signature else func_signature}",
    config=ObserveConfig(
        log_args=True,
        log_return=True
    )
)
def {func_signature}:
    """Observe stub wrapper - 原始逻辑请在下方实现"""
    pass

# 原始函数重命名为 _real_
# {func_signature.split('(')[0] if '(' in func_signature else func_signature}_real = {func_signature.split('(')[0] if '(' in func_signature else func_signature}
'''
    
    if output:
        with open(output, 'w') as f:
            f.write(stub_code)
        print(f"[evot] Stub generated: {output}")
    else:
        print(stub_code)

def generate_stub_for_file(filepath, output):
    """为单个 Python 文件生成 stubs"""
    with open(filepath, 'r') as f:
        content = f.read()
    
    output_path = output or filepath.replace('.py', '_stub.py')
    
    stub_code = f'''# evot observe stub - File: {filepath} - Generated {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

import sys
sys.path.insert(0, '~/Polarisor/macbook')

from {filepath.replace('.py', '').replace('/', '.')} import *
from evot_observe_stub import (
    observe_stub,
    ObserveConfig,
    StubRegistry,
    make_mock_config
)

# === Observer Pattern Stubs ===

class Subject:
    """被观察者基类 - 自动生成的 stub"""
    def __init__(self):
        self._observers = []
    
    def attach(self, observer):
        if observer not in self._observers:
            self._observers.append(observer)
    
    def detach(self, observer):
        if observer in self._observers:
            self._observers.remove(observer)
    
    def notify(self, event, data=None):
        for obs in self._observers:
            obs.update(self, event, data or {{}})

# === Data Collector Stub ===

class DataCollector:
    """数据采集器 stub"""
    def __init__(self):
        self._buffer = []
    
    def collect(self, metric, value, tags=None):
        self._buffer.append({{
            "metric": metric,
            "value": value,
            "tags": tags or {{}},
            "timestamp": "{datetime.now().isoformat()}"
        }})
        return {{"status": "collected"}}
    
    def query(self, metric=None, limit=1000):
        data = self._buffer
        if metric:
            data = [d for d in data if d["metric"] == metric]
        return data[-limit:]
'''
    
    with open(output_path, 'w') as f:
        f.write(stub_code)
    print(f"[evot] Stubs generated for {filepath}: {output_path}")

def generate_stubs_for_dir(dirpath, output):
    """为目录中所有 Python 文件生成 stubs"""
    output_dir = output or os.path.join(dirpath, 'evot_stubs')
    os.makedirs(output_dir, exist_ok=True)
    
    count = 0
    for root, dirs, files in os.walk(dirpath):
        for f in files:
            if f.endswith('.py') and f != '__init__.py':
                filepath = os.path.join(root, files)
                rel_path = os.path.relpath(filepath, dirpath)
                stub_file = os.path.join(output_dir, f'evot_stub_{rel_path}')
                generate_stub_for_file(filepath, stub_file)
                count += 1
    
    print(f"[evot] Generated {count} stub files in {output_dir}")

def main():
    parser = argparse.ArgumentParser(
        description='evot - Observer Pattern & Data Collection Framework'
    )
    subparsers = parser.add_subparsers(dest='command', help='Commands')
    
    # observe stub 命令
    stub_parser = subparsers.add_parser('observe', help='Observe stub commands')
    stub_subparsers = stub_parser.add_subparsers(dest='subcommand', help='Observe subcommands')
    
    # observe stub 子命令
    observe_stub_parser = stub_subparsers.add_parser('stub', help='Generate observe stubs')
    observe_stub_parser.add_argument('target', help='Function signature, file, or directory')
    observe_stub_parser.add_argument('-o', '--output', help='Output file path')
    observe_stub_parser.set_defaults(func=cmd_observe_stub)
    
    # observe collect 子命令
    collect_parser = stub_subparsers.add_parser('collect', help='Collect data')
    collect_parser.add_argument('metric', help='Metric name')
    collect_parser.add_argument('value', help='Metric value')
    collect_parser.add_argument('--tags', '-t', help='Tags as JSON')
    collect_parser.set_defaults(func=lambda args: cmd_collect(args))
    
    args = parser.parse_args()
    
    if hasattr(args, 'func'):
        args.func(args)
    else:
        parser.print_help()

def cmd_collect(args):
    """采集数据命令"""
    from evot_observe_stub import get_collector
    
    tags = json.loads(args.tags) if args.tags else None
    collector = get_collector()
    result = collector.collect(args.metric, args.value, tags)
    print(json.dumps(result, indent=2))

if __name__ == '__main__':
    main()
