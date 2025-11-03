# make_manifest.py
import os, json

ROOT = "Data"  # folder that holds your .geojson files

def group_key(filename: str) -> str:
    """Group by text before first underscore; fallback to 'Other'."""
    base = os.path.basename(filename)
    if "_" in base:
        return base.split("_", 1)[0]
    return "Other"

def main():
    groups = {}
    if not os.path.isdir(ROOT):
        raise SystemExit(f"Folder '{ROOT}' not found. Create it and add your .geojson files.")

    for name in os.listdir(ROOT):
        if not name.lower().endswith(".geojson"):
            continue
        group = group_key(name)
        groups.setdefault(group, []).append(name)

    # sort files within each group, and sort groups by name
    groups = {g: sorted(v, key=str.lower) for g, v in sorted(groups.items(), key=lambda x: x[0].lower())}

    with open("manifest.json", "w", encoding="utf-8") as f:
        json.dump(groups, f, indent=2, ensure_ascii=False)

    total = sum(len(v) for v in groups.values())
    print(f"✅ wrote manifest.json with {total} layers in {len(groups)} groups")

if __name__ == "__main__":
    main()
