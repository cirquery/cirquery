-- examples/sqlite/seed.sql
DELETE FROM ingredients;
DELETE FROM cocktails;

INSERT INTO cocktails (id, name, category, year) VALUES
  (1, 'Gin Tonic', 'Spirits', 1954),
  (2, 'Rum & Coke', 'Spirits', 1963),
  (3, 'Evian', 'Drink', 2020),
  (4, 'Café Gin Fizz', 'Cocktail', 2019),
  (5, 'Tequila Sunrise', 'Spirits', 1970);

INSERT INTO ingredients (id, cocktail_id, name, alcohol_content) VALUES
  (1, 1, 'gin', 40),
  (2, 1, 'tonic', 0),

  (3, 2, 'rum', 37),
  (4, 2, 'coke', 0),

  -- Evian は空配列のため材料なし

  (5, 4, 'gin', 38),
  (6, 4, 'lemon', 0),
  (7, 4, 'syrup', 0),

  (8, 5, 'tequila', 40),
  (9, 5, 'orange', 0);
