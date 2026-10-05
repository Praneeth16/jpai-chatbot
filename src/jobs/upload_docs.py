"""Copy the PDFs shipped with the bundle (data/docs/*.pdf) into the docs volume when they are not there yet.

Bundle files are synced to the workspace, so the source folder is ${workspace.file_path}/data/docs. Existing files in
the volume are never overwritten here (a revision uploaded through the app replaces its file and the pipeline, which
reads with allowOverwrites, parses it again). Both .pdf and .PDF are copied.
"""
import argparse
import os
import shutil


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src-dir", required=True)
    ap.add_argument("--volume-path", required=True, help="/Volumes/<catalog>/<schema>/docs")
    a = ap.parse_args()
    os.makedirs(a.volume_path, exist_ok=True)
    pdfs = sorted(os.path.join(a.src_dir, f) for f in os.listdir(a.src_dir) if f.lower().endswith(".pdf"))
    copied = 0
    for src in pdfs:
        dst = os.path.join(a.volume_path, os.path.basename(src))
        if os.path.exists(dst):
            print(f"exists, skipped: {dst}")
            continue
        shutil.copyfile(src, dst)
        copied += 1
        print(f"copied: {dst}")
    print(f"{copied} copied, {len(pdfs) - copied} already present")


if __name__ == "__main__":
    main()
