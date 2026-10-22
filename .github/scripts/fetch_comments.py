"""Collect reader comments (GitHub Discussions) into site/comments.json while the site is being published.

A reader comment is a discussion whose body carries the marker the site adds when someone presses
"Comment" on a selected passage:   <!-- agreement-machinery: {"page": ..., "quote": ..., ...} -->
Replies to the discussion become replies under the note. Deleted or hidden ("minimized") comments are
left out, so moderating on GitHub moderates the site.

Runs inside GitHub Actions with the workflow's GITHUB_TOKEN (permission: discussions: read).
"""
import json, os, re, sys, urllib.request

REPO = os.environ.get("GITHUB_REPOSITORY", "dudugan/agreement-machinery")
TOKEN = os.environ.get("GITHUB_TOKEN")
OUT = sys.argv[1] if len(sys.argv) > 1 else "site/comments.json"
MARK = re.compile(r"<!--\s*agreement-machinery:\s*(\{.*?\})\s*-->", re.S)

QUERY = """
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    discussions(first: 50, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id number url body bodyHTML createdAt
        author { login avatarUrl url }
        comments(first: 100) {
          nodes {
            id bodyHTML createdAt isMinimized url
            author { login avatarUrl url }
            replies(first: 50) { nodes { id bodyHTML createdAt isMinimized url author { login avatarUrl url } } }
          }
        }
      }
    }
  }
}"""


def gql(variables):
    req = urllib.request.Request(
        "https://api.github.com/graphql",
        data=json.dumps({"query": QUERY, "variables": variables}).encode(),
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as r:
        data = json.load(r)
    if "errors" in data:
        raise RuntimeError(data["errors"])
    return data["data"]


def clean(html):
    """Drop the quoted passage (the site highlights it instead) and any HTML comments."""
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    html = re.sub(r"^\s*<blockquote>.*?</blockquote>", "", html, count=1, flags=re.S)
    return html.strip()


def person(a):
    a = a or {}
    return {"login": a.get("login", "ghost"), "avatar": a.get("avatarUrl", ""), "url": a.get("url", "")}


def main():
    if not TOKEN:
        print("GITHUB_TOKEN not set; writing no comments")
        json.dump([], open(OUT, "w"))
        return
    owner, name = REPO.split("/")
    out, after = [], None
    try:
        while True:
            d = gql({"owner": owner, "name": name, "after": after})["repository"]["discussions"]
            for disc in d["nodes"]:
                m = MARK.search(disc["body"] or "")
                if not m:
                    continue
                try:
                    anchor = json.loads(m.group(1))
                except ValueError:
                    continue
                replies = []
                for c in disc["comments"]["nodes"]:
                    if c["isMinimized"]:
                        continue
                    replies.append({"id": c["id"], "author": person(c["author"]), "html": clean(c["bodyHTML"]), "date": c["createdAt"], "url": c["url"]})
                    for r in c["replies"]["nodes"]:
                        if not r["isMinimized"]:
                            replies.append({"id": r["id"], "author": person(r["author"]), "html": clean(r["bodyHTML"]), "date": r["createdAt"], "url": r["url"]})
                out.append({
                    "id": disc["id"], "number": disc["number"], "url": disc["url"],
                    "page": str(anchor.get("page", "")), "quote": str(anchor.get("quote", ""))[:400],
                    "prefix": str(anchor.get("prefix", ""))[:60], "suffix": str(anchor.get("suffix", ""))[:60],
                    "author": person(disc["author"]), "html": clean(disc["bodyHTML"]), "date": disc["createdAt"],
                    "replies": replies,
                })
            if not d["pageInfo"]["hasNextPage"]:
                break
            after = d["pageInfo"]["endCursor"]
    except Exception as e:  # Discussions turned off, or any API trouble: publish the site without comments
        print(f"could not fetch comments: {e}")
        out = []
    json.dump(out, open(OUT, "w"), ensure_ascii=False)
    print(f"wrote {len(out)} reader comment(s) to {OUT}")


if __name__ == "__main__":
    main()
