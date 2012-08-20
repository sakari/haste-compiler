#!/usr/bin/env bash
set -e
hastec --with-js=test.js --out=out.js Test.hs
node runnode.js