"""
Model Training Script
Run this to train the classifier from labeled data.

Usage:
    python ml/train.py

Creates:
    ml/models/classifier.pkl
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import csv
import joblib
import numpy as np
from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.metrics import classification_report
from core.config import settings

CATEGORIES = ["placement", "faculty", "department", "spam"]
DATA_PATH = "ml/data/seed_labels.csv"
MODEL_PATH = settings.ML_CLASSIFIER_PATH


def load_data(path: str) -> tuple[list[str], list[str]]:
    texts, labels = [], []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            text = f"{row.get('subject', '')} {row.get('body', '')}"
            label = row.get("category", "").strip().lower()
            if label in CATEGORIES and text.strip():
                texts.append(text)
                labels.append(label)
    print(f"Loaded {len(texts)} labeled samples")
    return texts, labels


def train(texts: list[str], labels: list[str]) -> Pipeline:
    pipeline = Pipeline([
        ("tfidf", TfidfVectorizer(
            ngram_range=(1, 2),
            max_features=15_000,
            stop_words="english",
            sublinear_tf=True,
            min_df=1,
        )),
        ("clf", LogisticRegression(
            max_iter=1000,
            C=1.0,
            solver="lbfgs",
            multi_class="multinomial",
            class_weight="balanced",    # handles imbalanced classes
        ))
    ])

    # Cross-validation
    scores = cross_val_score(pipeline, texts, labels, cv=5, scoring="f1_weighted")
    print(f"Cross-val F1 (5-fold): {scores.mean():.3f} ± {scores.std():.3f}")

    # Train on full data
    pipeline.fit(texts, labels)

    # Test set evaluation
    X_train, X_test, y_train, y_test = train_test_split(
        texts, labels, test_size=0.2, random_state=42, stratify=labels
    )
    pipeline_eval = Pipeline([
        ("tfidf", TfidfVectorizer(ngram_range=(1, 2), max_features=15_000,
                                  stop_words="english", sublinear_tf=True)),
        ("clf", LogisticRegression(max_iter=1000, C=1.0, multi_class="multinomial",
                                   class_weight="balanced"))
    ])
    pipeline_eval.fit(X_train, y_train)
    y_pred = pipeline_eval.predict(X_test)
    print("\nClassification Report (held-out 20%):")
    print(classification_report(y_test, y_pred, target_names=CATEGORIES))

    return pipeline


def main():
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    texts, labels = load_data(DATA_PATH)
    if len(texts) < 20:
        print("⚠️  Need at least 20 labeled samples. Add more to ml/data/seed_labels.csv")
        return
    model = train(texts, labels)
    joblib.dump(model, MODEL_PATH)
    print(f"\n✅ Model saved to {MODEL_PATH}")
    print("The classifier will be loaded automatically by the backend.")


if __name__ == "__main__":
    main()
