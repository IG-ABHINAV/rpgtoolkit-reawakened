"""Independent XML 1.0 parser for the research typed-v mapping; no game execution."""
import json
import sys
import xml.etree.ElementTree as ET


def decode(node):
    kind = node.attrib['type']
    if kind == 'object':
        return {child.attrib['key']: decode(child) for child in node}
    if kind == 'array':
        return [decode(child) for child in node]
    if kind == 'null':
        return None
    text = node.text or ''
    if kind == 'string':
        return text
    if kind == 'boolean':
        if text not in ('true', 'false'):
            raise ValueError('XML_BOOLEAN_LEXICAL_VALUE must be true or false')
        return text == 'true'
    if kind == 'number':
        return json.loads(text)
    raise ValueError('Unknown typed-v kind: ' + kind)


try:
    print(json.dumps(decode(ET.fromstring(sys.stdin.read())), ensure_ascii=False))
except (ET.ParseError, ValueError, KeyError) as error:
    print(type(error).__name__ + ': ' + str(error), file=sys.stderr)
    raise SystemExit(1)
