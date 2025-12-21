import os
import json
from .config import COLLECTIONS_DIR
from .utils import ensure_dir


def _path(name: str) -> str:
  return os.path.join(COLLECTIONS_DIR, name + ".json")


def get_collections():
  ensure_dir(COLLECTIONS_DIR)
  out = []
  for f in os.listdir(COLLECTIONS_DIR):
    if f.endswith(".json"):
      out.append(f[:-5])
  return out


def load_collection(name):
  fp = _path(name)
  if not os.path.exists(fp):
    return []
  with open(fp, "r", encoding="utf-8") as f:
    return json.load(f)


def save_collection(name, files):
  ensure_dir(COLLECTIONS_DIR)
  with open(_path(name), "w", encoding="utf-8") as f:
    json.dump(files, f, indent=2)


def add_to_collection(name, path):
  data = load_collection(name)
  if path not in data:
    data.append(path)
  save_collection(name, data)


def remove_from_collection(name, path):
  data = load_collection(name)
  if path in data:
    data.remove(path)
  save_collection(name, data)
