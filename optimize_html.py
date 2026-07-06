import os
import re

html_files = [
    "index.html", "home.html", "tasks.html", "wallet.html", 
    "profile.html", "recharge.html", "refer.html", "legal.html", "support.html"
]

base_dir = r"c:\Users\babul\Music\anvipayz"

def optimize_html(filepath):
    if not os.path.exists(filepath):
        return
        
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find all <img ...> tags
    def img_replacer(match):
        img_tag = match.group(0)
        # Check if loading="lazy" is already there
        if 'loading="lazy"' not in img_tag and 'loading=' not in img_tag:
            img_tag = img_tag.replace('<img ', '<img loading="lazy" ')
        
        # Check if decoding="async" is already there
        if 'decoding="async"' not in img_tag and 'decoding=' not in img_tag:
            img_tag = img_tag.replace('<img ', '<img decoding="async" ')
            
        return img_tag

    # Replace <img ...> but ignore the logo in navbar to allow fast LCP. We'll just add it to all.
    content = re.sub(r'<img\s+[^>]+>', img_replacer, content)

    # Find all <script src="..."> that don't have defer or async, and add defer
    def script_replacer(match):
        script_tag = match.group(0)
        if ' src=' in script_tag and 'defer' not in script_tag and 'async' not in script_tag:
            script_tag = script_tag.replace('<script ', '<script defer ')
        return script_tag

    content = re.sub(r'<script\s+[^>]+>', script_replacer, content)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

for filename in html_files:
    print(f"Optimizing {filename}...")
    optimize_html(os.path.join(base_dir, filename))

print("HTML Optimization complete.")
