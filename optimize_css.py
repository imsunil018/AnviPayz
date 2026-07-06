import os
import re

css_dir = r"c:\Users\babul\Music\anvipayz\css"

def optimize_css_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Remove backdrop-filter: blur(...)
    content = re.sub(r'^\s*backdrop-filter:\s*blur\([^)]+\);\r?\n?', '', content, flags=re.MULTILINE)
    
    # Simplify complex box-shadows (ones with multiple shadows or heavy alpha)
    # Actually, simpler is to just reduce the spread/blur of big shadows, or replace them.
    # We will replace rgba(x, y, z, 0.35+) with rgba(x, y, z, 0.15) for box-shadow
    
    def shadow_replacer(match):
        # find the rgba opacity and reduce it if it's > 0.15
        shadow = match.group(0)
        return re.sub(r'rgba\(([^,]+,[^,]+,[^,]+,\s*)0\.[2-9]\d*\)', r'rgba(\g<1>0.15)', shadow)
        
    content = re.sub(r'box-shadow:[^;]+;', shadow_replacer, content)

    # Let's also simplify variables like --card-shadow, --cta-glow, etc.
    content = re.sub(r'(--card-shadow:\s*)[^;]+;', r'\g<1>0 4px 12px rgba(2, 6, 23, 0.15);', content)
    content = re.sub(r'(--cta-glow:\s*)[^;]+;', r'\g<1>0 4px 12px rgba(99, 102, 241, 0.15);', content)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

for root, dirs, files in os.walk(css_dir):
    for file in files:
        if file.endswith('.css'):
            print(f"Optimizing {file}...")
            optimize_css_file(os.path.join(root, file))

print("CSS Optimization complete.")
