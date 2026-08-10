# Knowledge Vector Search Index

Task 3.3.2 requires a MongoDB Atlas Vector Search index on the existing
`knowledge_chunks` collection.

Create a Vector Search index with this name:

```text
VECTOR_INDEX_NAME
```

Use the value configured in `.env`.

Index definition:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1024,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "knowledgeType"
    },
    {
      "type": "filter",
      "path": "companyId"
    },
    {
      "type": "filter",
      "path": "documentId"
    },
    {
      "type": "filter",
      "path": "scope"
    }
  ]
}
```

The application expects this index to exist before semantic retrieval is used.
If the index is missing or not ready, retrieval fails with a controlled
`VECTOR_INDEX_UNAVAILABLE` error.

