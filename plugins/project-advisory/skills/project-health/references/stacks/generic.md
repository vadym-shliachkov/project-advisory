# Stack pack: generic

No stack-specific guidance matched this project. Apply your area's rules as written.

- Identify the framework or tooling from config files at the project root (`package.json`, `composer.json`, `Gemfile`, `pyproject.toml`, `go.mod`, `Dockerfile`) and judge conventions against that tool's own documentation.
- When a rule assumes a website (meta tags, pages, forms) and the project serves pages through templates, look in the template folders instead of `*.html` files.
- The architecture area records the detected framework and its version as the fact architecture.framework. Other areas record facts only under their own area key.
