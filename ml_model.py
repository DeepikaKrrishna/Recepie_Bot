import os
import csv
import math
from collections import Counter
import re

def tokenize(text):
    text = str(text).lower()
    return re.findall(r'\b\w+\b', text)

def get_cosine_similarity(vec1, vec2):
    intersection = set(vec1.keys()) & set(vec2.keys())
    numerator = sum([vec1[x] * vec2[x] for x in intersection])

    sum1 = sum([vec1[x]**2 for x in vec1.keys()])
    sum2 = sum([vec2[x]**2 for x in vec2.keys()])
    denominator = math.sqrt(sum1) * math.sqrt(sum2)

    if not denominator:
        return 0.0
    else:
        return float(numerator) / denominator

class RecipeRecommender:
    def __init__(self, data_path="recipes.csv"):
        self.data_path = data_path
        self.recipes = []
        self._load_and_train()

    def _load_and_train(self):
        if not os.path.exists(self.data_path):
            print(f"Warning: {self.data_path} not found. Recommender will not have data.")
            return

        with open(self.data_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                ingredients = row.get('Ingredients', '')
                title = row.get('Title', '')
                tokens = tokenize(ingredients)
                vector = Counter(tokens)
                self.recipes.append({
                    'title': title,
                    'ingredients': ingredients,
                    'vector': vector
                })

    def suggest_recipes(self, user_ingredients, top_n=5):
        if not self.recipes:
            return []

        user_tokens = tokenize(user_ingredients)
        user_vector = Counter(user_tokens)

        scored_recipes = []
        for recipe in self.recipes:
            score = get_cosine_similarity(user_vector, recipe['vector'])
            scored_recipes.append((score, recipe))

        scored_recipes.sort(key=lambda x: x[0], reverse=True)

        results = []
        for score, recipe in scored_recipes[:top_n]:
            if score > 0:
                results.append(recipe['title'])
                
        if not results:
            # Fallback to general
            results = [r['title'] for r in self.recipes[:top_n]]

        return results
